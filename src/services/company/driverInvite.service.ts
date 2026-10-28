import { randomBytes } from 'node:crypto';
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
@Injectable()
export class DriverInviteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DriverInvite) private readonly invites: Repository<DriverInvite>,
    private readonly audience: CargoAudienceRepository,
    private readonly features: CompanyFeatureService,
    private readonly sms: InviteSmsService,
  ) {}

  //#region ----------- Company side ----------------------------------------------

  /**
   * Each number on its own: a refused one (bad number, a company's or factory's) does not stop the others. Then the
   * drivers invited hear of it by SMS: one alone gets its own link, several get one group SMS with the sign-in address.
   */
  async invite(companyUserId: string, drivers: DriverInviteInput[]): Promise<{ outcomes: DriverInviteOutcome[]; sms: InviteSmsResult }> {
    const outcomes = await this.inviteAll(companyUserId, drivers);
    const invited = outcomes.filter((outcome): outcome is Extract<DriverInviteOutcome, { token: string }> => outcome.status !== 'refused');
    return { outcomes, sms: await this.notify(companyUserId, invited) };
  }

  private async notify(companyUserId: string, invited: Array<{ mobile: string; token: string }>): Promise<InviteSmsResult> {
    if (!invited.length) return { status: 'sent', count: 0 };
    const panel = this.sms.panelUrl();
    if (!panel) return { status: 'notConfigured', count: invited.length };
    const intro = `«${await this.companyName(companyUserId)}» شما را به رانندگانش اضافه کرده و بارهایش برایتان اعلام می‌شود.`;
    if (invited.length === 1) return this.sms.sendOne(invited[0].mobile, `${intro}\nورود با همین شماره:\n${panel}/driver-invite/${invited[0].token}`);
    return this.sms.sendGroup(invited.map((item) => item.mobile), `${intro}\nورود با همین شماره:\n${panel}/auth/login`);
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
    await this.join(manager, driverUserId, companyUserId);
    const existing = await manager.findOne(DriverInvite, { where: { companyUserId, driverUserId } });
    const invite = existing?.revokedAt
      ? await manager.save(DriverInvite, Object.assign(existing, { revokedAt: null }))
      : existing ?? (await manager.save(DriverInvite, manager.create(DriverInvite, { companyUserId, driverUserId, mobile, token: randomBytes(18).toString('base64url') })));
    return { status: created ? ('created' as const) : ('added' as const), driverUserId, token: invite.token };
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
    return rows;
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

  /** The account that came in with the link is the invited driver (same number)? Marks the link used. */
  async isInvited(userId: string, token: string): Promise<boolean> {
    const invite = await this.activeInvite(token);
    if (!invite || invite.driverUserId !== userId) return false;
    if (!invite.usedAt) await this.invites.update({ id: invite.id }, { usedAt: new Date() });
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
    return invite && (await this.features.hasFeature(invite.companyUserId, CompanyFeature.Drivers)) ? invite : null;
  }

  private async companyName(companyUserId: string): Promise<string> {
    return (await this.audience.findPublisherContact(companyUserId)).company?.name || 'شرکت حمل‌ونقل';
  }
}

const displayName = (alias: string) =>
  `COALESCE(NULLIF(concat_ws(' ', ${alias}."firstName", ${alias}."lastName"), ''), ${alias}.mobile, ${alias}.username)`;
