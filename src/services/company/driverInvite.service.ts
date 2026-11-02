import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import { Role } from 'src/domain/entities/auth/Role';
import { User } from 'src/domain/entities/auth/User';
import { UserRole } from 'src/domain/entities/auth/UserRole';
import { DriverInvite } from 'src/domain/entities/company/DriverInvite';
import { DriverProfile } from 'src/domain/entities/driver/DriverProfile';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { CustomerType } from 'src/domain/enums/company.enum';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { CargoAudienceRepository } from 'src/infrastructure/repositories/notification/cargoAudience.repository';
import { DriverInviteResult } from '../messengerBot/core/factoryInvite';
import { CompanyFeatureService } from './companyFeature.service';
import { maskMobile } from './companyInvite.service';
import { InviteSmsResult, InviteSmsService } from './inviteSms.service';
import { inviteToken } from './inviteLinks';
import { RedisService } from '../redis/redis.service';
import { InviteUsedEvent, REDIS_CHANNELS } from '../redis/redis.keys';

const DRIVER_ROLE = 'DRIVER';
/** at most this many drivers in one batch */
export const MAX_DRIVER_INVITES = 200;

export interface DriverInviteInput {
  mobile: string;
  name?: string | null;
}

/** One line of a batch: invited (a new account or an existing driver), or refused and why. */
export type DriverInviteOutcome =
  | { mobile: string; status: 'created' | 'added'; driverUserId: string; token: string }
  | { mobile: string; status: 'refused'; reason: string };

/**
 * شرکت حمل‌ونقل راننده‌ها را با شماره‌شان دعوت می‌کند (تکی یا چندتایی): حساب راننده همان لحظه ساخته می‌شود (یا
 * راننده‌ی قبلی پیدا می‌شود) و شرکت به لیست شرکت‌های راننده می‌رود تا بارهایش برای او اعلام شود. راننده با همان
 * شماره وارد وب یا پیام‌رسان‌ها می‌شود؛ لینک (/driver-invite/…) و کد (drv_…) فقط برای همان شماره کار می‌کنند.
 * جزو بخش «رانندگان» پنل شرکت است (CompanyFeature.Drivers).
 */
/** how long an invite waits for its driver (DRIVER_INVITE_EXPIRY_HOURS, a day by default) */
export const driverInviteExpiryHours = () => Number(process.env.DRIVER_INVITE_EXPIRY_HOURS) || 24;

/** an invite nobody used within its time is over: its link stops, and a sweep revokes it (expireStale) */
const isExpired = (invite: Pick<DriverInvite, 'usedAt' | 'createdAt'>) =>
  !invite.usedAt && Date.now() - new Date(invite.createdAt!).getTime() > driverInviteExpiryHours() * 60 * 60_000;

@Injectable()
export class DriverInviteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DriverInvite) private readonly invites: Repository<DriverInvite>,
    private readonly audience: CargoAudienceRepository,
    private readonly features: CompanyFeatureService,
    private readonly sms: InviteSmsService,
    private readonly redis: RedisService,
  ) {}

  //#region ----------- Company side ----------------------------------------------

  /**
   * Each number on its own: a refused one (bad number, a company's or factory's) does not stop the others. Then the
   * drivers invited hear of it by SMS, each with its own web and messenger links.
   */
  async invite(companyUserId: string, drivers: DriverInviteInput[]): Promise<{ outcomes: DriverInviteOutcome[]; sms: InviteSmsResult }> {
    const outcomes = await this.inviteAll(companyUserId, drivers);
    const invited = outcomes.filter((outcome): outcome is Extract<DriverInviteOutcome, { token: string }> => outcome.status !== 'refused');
    return { outcomes, sms: await this.notify(companyUserId, invited) };
  }

  private async notify(companyUserId: string, invited: Array<{ mobile: string; token: string }>): Promise<InviteSmsResult> {
    // every driver gets its own links, so a batch goes number by number
    const inviter = await this.companyName(companyUserId);
    let failed = false;
    for (const { mobile, token } of invited) {
      const result = await this.sms.sendInvite(mobile, `/driver-invite/${token}`, inviter);
      if (result.status === 'off' || result.status === 'notConfigured') return { status: result.status, count: invited.length };
      failed ||= result.status === 'failed';
    }
    return { status: failed ? 'failed' : 'sent', count: invited.length };
  }


  private async inviteAll(companyUserId: string, drivers: DriverInviteInput[]): Promise<DriverInviteOutcome[]> {
    if (!drivers.length) throw new BadRequestException('دست‌کم یک شماره وارد کنید.');
    if (drivers.length > MAX_DRIVER_INVITES) throw new BadRequestException(`حداکثر ${MAX_DRIVER_INVITES} راننده در هر بار.`);
    const outcomes: DriverInviteOutcome[] = [];
    const seen = new Set<string>();
    for (const { mobile: input, name } of drivers) {
      const mobile = normalizePhoneNumber(input);
      if (typeof mobile !== 'string' || !/^09[0-9]{9}$/.test(mobile)) {
        outcomes.push({ mobile: input, status: 'refused', reason: 'شماره موبایل معتبر نیست.' });
        continue;
      }
      if (seen.has(mobile)) continue;
      seen.add(mobile);
      try {
        outcomes.push({ mobile, ...(await this.dataSource.transaction((manager) => this.inviteOne(manager, companyUserId, mobile, name?.trim() || null))) });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        outcomes.push({ mobile, status: 'refused', reason: error.message });
      }
    }
    return outcomes;
  }

  private async inviteOne(manager: EntityManager, companyUserId: string, mobile: string, name: string | null) {
    let driver = await manager.findOne(User, { where: { mobile }, relations: { userRoles: { role: true } } });
    const roles = driver?.userRoles?.filter((item) => item.role?.recordStatus === RecordStatus.Active).map((item) => item.role.name) ?? [];
    if (roles.length && !roles.includes(DRIVER_ROLE)) throw new ConflictException('این شماره حساب شرکت حمل‌ونقل یا شرکت / کارخانه است.');
    const created = !roles.length;
    if (created) {
      const role = await manager.findOne(Role, { where: { name: DRIVER_ROLE, recordStatus: RecordStatus.Active } });
      if (!role) throw new BadRequestException('نقش راننده در سامانه تعریف نشده است.');
      driver = driver ?? manager.create(User, { username: mobile, mobile, recordStatus: RecordStatus.Active });
      if (name) {
        // «علی رضایی»: first word the first name, the rest the last name (the driver can correct it in its profile)
        const [firstName, ...rest] = name.split(/\s+/);
        Object.assign(driver, { firstName, lastName: rest.join(' ') || null, profileType: CustomerType.Person });
      }
      driver = await manager.save(User, driver);
      await manager.save(UserRole, manager.create(UserRole, { userId: driver.id, roleId: role.id }));
    }
    const driverUserId = driver!.id;
    if (!created) await this.assertInvitable(manager, companyUserId, driver!);
    await this.join(manager, driverUserId, companyUserId);
    const existing = await manager.findOne(DriverInvite, { where: { companyUserId, driverUserId } });
    const invite = existing?.revokedAt
      ? await manager.save(DriverInvite, Object.assign(existing, { revokedAt: null }))
      : existing ?? (await manager.save(DriverInvite, manager.create(DriverInvite, { companyUserId, driverUserId, mobile, token: inviteToken() })));
    return { status: created ? ('created' as const) : ('added' as const), driverUserId, token: invite.token };
  }

  /**
   * A driver account that is there already: one more invite only for this company's own invite still waiting (the
   * SMS goes again). A driver who came in (by an invite or by finding Trabot alone) needs none; one another company's
   * invite is waiting for belongs to it until that invite is used or its day is over.
   */
  private async assertInvitable(manager: EntityManager, companyUserId: string, driver: User): Promise<void> {
    const invites = await manager.find(DriverInvite, { where: { driverUserId: driver.id } });
    const live = invites.filter((invite) => !invite.revokedAt);
    const waiting = live.filter((invite) => !invite.usedAt && !isExpired(invite));
    if (waiting.some((invite) => invite.companyUserId === companyUserId)) return;
    if (waiting.length) {
      throw new ConflictException(`این راننده را شرکت دیگری دعوت کرده است؛ اگر تا ${driverInviteExpiryHours()} ساعت وارد نشود، می‌توانید دعوتش کنید.`);
    }
    // an account only an invite made and nobody came in with (its invite's day over): free for a new invite
    const madeByInvite = invites.some((invite) => Math.abs(new Date(invite.createdAt!).getTime() - new Date(driver.createdAt!).getTime()) < 60_000);
    if (madeByInvite && !invites.some((invite) => invite.usedAt)) return;
    throw new ConflictException('این راننده خودش در ترابوت است و دعوت لازم ندارد.');
  }

  /** The company joins the driver's companies, so its loads are announced to the driver. */
  private async join(manager: EntityManager, driverUserId: string, companyUserId: string): Promise<void> {
    const profile = await manager.findOne(DriverProfile, { where: { userId: driverUserId } });
    if (!profile) {
      await manager.save(DriverProfile, manager.create(DriverProfile, { userId: driverUserId, companyUserIds: [companyUserId] }));
    } else if (!profile.companyUserIds?.includes(companyUserId)) {
      profile.companyUserIds = [...(profile.companyUserIds ?? []), companyUserId];
      await manager.save(DriverProfile, profile);
    }
  }

  /** راننده‌هایی که این شرکت دعوت کرده، جدیدترین اول. */
  async list(companyUserId: string) {
    const rows: Array<{ driverUserId: string; name: string; mobile: string; token: string; usedAt: Date | null; createdAt: Date }> = await this.dataSource.query(
      `SELECT i."driverUserId", ${displayName('u')} AS name, i.mobile, i.token, i."usedAt", i."createdAt"
       FROM "DriverInvite" i JOIN "User" u ON u.id = i."driverUserId"
       WHERE i."companyUserId" = $1 AND i."revokedAt" IS NULL
       ORDER BY i."createdAt" DESC`,
      [companyUserId],
    );
    // an invite past its day is gone already for the company, even before the sweep revokes it
    return rows
      .filter((row) => !isExpired(row))
      .map((row) => ({
        ...row,
        expiresAt: row.usedAt ? null : new Date(new Date(row.createdAt).getTime() + driverInviteExpiryHours() * 60 * 60_000),
      }));
  }

  /**
   * Invites nobody used within their day: revoked, the company leaves the driver's companies, and the account the
   * invite made goes too when its driver never came in and no one else invited them. The inviting company's open
   * page hears of each. Returns how many expired.
   */
  async expireStale(): Promise<number> {
    const stale: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM "DriverInvite"
        WHERE "usedAt" IS NULL AND "revokedAt" IS NULL AND "createdAt" < now() - make_interval(hours => $1)`,
      [driverInviteExpiryHours()],
    );
    let expired = 0;
    for (const { id } of stale) {
      const gone = await this.dataSource.transaction(async (manager) => {
        const rows = (await manager.query(
          `UPDATE "DriverInvite" SET "revokedAt" = now() WHERE id = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL
           RETURNING "companyUserId", "driverUserId"`,
          [id],
        )) as [Array<{ companyUserId: string; driverUserId: string }>, number];
        const invite = rows[0][0];
        if (!invite) return null;
        await manager.query(
          `UPDATE "DriverProfile" SET "companyUserIds" = array_remove("companyUserIds", $2) WHERE "userId" = $1`,
          [invite.driverUserId, invite.companyUserId],
        );
        // the account only this invite made, and nobody ever used: nothing of the driver is in it
        await manager.query(
          `DELETE FROM "User" u USING "DriverInvite" made
            WHERE u.id = $1 AND made.id = $2
              AND made."createdAt" BETWEEN u."createdAt" - interval '1 minute' AND u."createdAt" + interval '1 minute'
              AND NOT EXISTS (SELECT 1 FROM "DriverInvite" i WHERE i."driverUserId" = u.id AND (i."usedAt" IS NOT NULL OR i."revokedAt" IS NULL))
              AND NOT EXISTS (SELECT 1 FROM "BotLink" b WHERE b."userId" = u.id)
              AND NOT EXISTS (SELECT 1 FROM "WhatsappUserMapping" w WHERE w.userid::text = u.id::text)`,
          [invite.driverUserId, id],
        );
        return invite;
      });
      if (!gone) continue;
      expired += 1;
      const event: InviteUsedEvent = { kind: 'driver', inviterUserId: gone.companyUserId, inviteeUserId: gone.driverUserId, expired: true };
      await this.redis.publish(REDIS_CHANNELS.inviteUsed, JSON.stringify(event)).catch(() => undefined);
    }
    return expired;
  }

  /** دعوت باطل و شرکت از لیست شرکت‌های راننده برداشته می‌شود؛ حساب راننده می‌ماند. */
  async remove(companyUserId: string, driverUserId: string): Promise<{ driverUserId: string }> {
    const result = await this.invites.update({ companyUserId, driverUserId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw new NotFoundException('این راننده در دعوت‌های شما نیست.');
    const profile = await this.dataSource.getRepository(DriverProfile).findOne({ where: { userId: driverUserId } });
    if (profile?.companyUserIds?.includes(companyUserId)) {
      profile.companyUserIds = profile.companyUserIds.filter((id) => id !== companyUserId);
      await this.dataSource.getRepository(DriverProfile).save(profile);
    }
    return { driverUserId };
  }

  //#endregion

  //#region ----------- The invited driver ---------------------------------------

  /** صفحه‌ی لینک (بی‌ورود): شرکت دعوت‌کننده و شماره‌ی دعوت‌شده (پوشیده). */
  async info(token: string): Promise<{ valid: boolean; companyName: string | null; mobile: string | null }> {
    const invite = await this.activeInvite(token);
    if (!invite) return { valid: false, companyName: null, mobile: null };
    return { valid: true, companyName: await this.companyName(invite.companyUserId), mobile: maskMobile(invite.mobile) };
  }

  /**
   * The account that came in with the link (or its code in a messenger) is the invited driver (same number)? Marks
   * the invite used, and used by its link: the company's drivers list says «با لینک دعوت شما».
   */
  async isInvited(userId: string, token: string): Promise<boolean> {
    const invite = await this.activeInvite(token);
    if (!invite || invite.driverUserId !== userId) return false;
    if (!invite.usedAt || !invite.usedByLink) await this.invites.update({ id: invite.id }, { usedAt: invite.usedAt ?? new Date(), usedByLink: true });
    return true;
  }

  /** ربات‌ها و واتساپ، بعد از اینکه شماره معلوم شد: خوشامد، یا اینکه دعوت برای شماره‌ی دیگری است. */
  async welcome(userId: string, token: string): Promise<DriverInviteResult> {
    const invite = await this.activeInvite(token);
    if (!invite) return { status: 'invalid' };
    if (!(await this.isInvited(userId, token))) return { status: 'otherNumber' };
    return { status: 'joined', companyName: await this.companyName(invite.companyUserId) };
  }

  //#endregion

  /** In force: not revoked, and the company still has its «رانندگان» menu. */
  private async activeInvite(token: string): Promise<DriverInvite | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const invite = await this.invites.findOne({ where: { token, revokedAt: IsNull() } });
    if (!invite || isExpired(invite)) return null;
    return (await this.features.hasFeature(invite.companyUserId, CompanyFeature.Drivers)) ? invite : null;
  }

  private async companyName(companyUserId: string): Promise<string> {
    return (await this.audience.findPublisherContact(companyUserId)).company?.name || 'شرکت حمل‌ونقل';
  }
}

const displayName = (alias: string) =>
  `COALESCE(NULLIF(concat_ws(' ', ${alias}."firstName", ${alias}."lastName"), ''), ${alias}.mobile, ${alias}.username)`;
