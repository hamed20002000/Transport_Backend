import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Role } from 'src/domain/entities/auth/Role';
import { User } from 'src/domain/entities/auth/User';
import { UserRole } from 'src/domain/entities/auth/UserRole';
import { BrokerInvite } from 'src/domain/entities/company/BrokerInvite';
import { CustomerType } from 'src/domain/enums/company.enum';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { BROKER_ROLE } from '../notification/loadRequesters';
import { BrokerAccessService } from './brokerAccess.service';
import { maskMobile } from './companyInvite.service';
import { InviteSmsService } from './inviteSms.service';
import { inviteToken } from './inviteLinks';
import { assertInvitable, inviteExpiresAt, isInviteExpired, isInviteWaiting, renewedInvite } from './inviteRules';

export type BrokerInviteResult =
  /** companyName: the transport company that invited the broker */
  | { status: 'joined'; companyName: string }
  | { status: 'invalid' }
  /** the number given is not the one the company invited */
  | { status: 'otherNumber' };

/**
 * A transport company invites a broker by its number, as it invites a factory: the broker's account is made right
 * away (approved: the inviting company vouches for it) and joins the company's list of brokers. While the admin
 * limits the companies a broker sees, the inviting company joins the broker's pick when there is room
 * (BrokerAccessService.addInvitingCompany). The link (/broker-invite/…) and code (brk_…) only let that number in,
 * for a day (inviteRules).
 */
@Injectable()
export class BrokerInviteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(BrokerInvite) private readonly invites: Repository<BrokerInvite>,
    private readonly access: BrokerAccessService,
    private readonly sms: InviteSmsService,
  ) {}

  //#region ----------- Company side ---------------------------------------------

  /**
   * The broker's account with this number, ready to sign in to. A number of a driver, a company or a factory is
   * refused; so is a broker already in Trabot or one another company's invite waits for (inviteRules.assertInvitable).
   * Inviting the same number again gives back its invite, with a new day when its old one was over.
   */
  async create(companyUserId: string, mobileInput: string, brokerName?: string | null) {
    const mobile = normalizePhoneNumber(mobileInput);
    if (typeof mobile !== 'string' || !/^09[0-9]{9}$/.test(mobile)) throw new BadRequestException('شماره موبایل معتبر نیست؛ مثلاً 09121234567.');
    const name = brokerName?.trim() || null;

    const invite = await this.dataSource.transaction(async (manager) => {
      let broker = await manager.findOne(User, { where: { mobile }, relations: { userRoles: { role: true } } });
      const roles = broker?.userRoles?.filter((item) => item.role?.recordStatus === RecordStatus.Active).map((item) => item.role.name) ?? [];
      if (roles.length && !roles.includes(BROKER_ROLE)) throw new ConflictException('این شماره حساب راننده، شرکت یا کارخانه است و نمی‌شود آن را واسط دعوت کرد.');
      if (!roles.length) {
        const role = await manager.findOne(Role, { where: { name: BROKER_ROLE, recordStatus: RecordStatus.Active } });
        if (!role) throw new BadRequestException('نقش واسط در سامانه تعریف نشده است.');
        broker = broker ?? manager.create(User, { username: mobile, mobile, recordStatus: RecordStatus.Active });
        if (name) Object.assign(broker, { companyName: name, profileType: CustomerType.Company });
        broker = await manager.save(User, broker);
        await manager.save(UserRole, manager.create(UserRole, { userId: broker.id, roleId: role.id }));
      }
      const brokerUserId = broker!.id;
      if (roles.length) {
        const invites = await manager.find(BrokerInvite, { where: { brokerUserId } });
        assertInvitable(invites.map((invite) => ({ ...invite, inviterId: invite.companyUserId })), companyUserId, broker!.createdAt, 'واسط');
      }
      // a broker that signed up on its own and is not checked yet: the company inviting it vouches for it
      if (roles.length && broker!.verificationStatus !== 'APPROVED') {
        await manager.update(User, { id: brokerUserId }, { verificationStatus: 'APPROVED', verificationDecidedAt: new Date(), verificationDecidedBy: companyUserId });
      }
      const existing = await manager.findOne(BrokerInvite, { where: { companyUserId, brokerUserId } });
      if (existing && !isInviteWaiting(existing)) {
        // the pair's one row, again: a new token and a new day (inviteRules.renewedInvite)
        const fresh = renewedInvite();
        await manager.update(BrokerInvite, { id: existing.id }, fresh);
        return Object.assign(existing, fresh);
      }
      return existing ?? manager.save(BrokerInvite, manager.create(BrokerInvite, { companyUserId, brokerUserId, mobile, token: inviteToken() }));
    });
    await this.access.addInvitingCompany(invite.brokerUserId, companyUserId);
    const sms = await this.sms.sendInvite(invite.mobile, `/broker-invite/${invite.token}`, await this.name(companyUserId));
    return {
      token: invite.token,
      mobile: invite.mobile,
      brokerUserId: invite.brokerUserId,
      usedAt: invite.usedAt ?? null,
      name: name ?? (await this.name(invite.brokerUserId)),
      expiresAt: inviteExpiresAt(invite),
      sms,
    };
  }

  /** واسط‌هایی که این شرکت دعوت کرده، جدیدترین اول، با دعوت هر کدام و تعداد درخواست‌هایشان برای بارهای این شرکت. */
  async list(companyUserId: string) {
    const rows: Array<{ userId: string; name: string; mobile: string | null; accountCode: string | null; token: string; usedAt: Date | null; createdAt: Date; requests: number }> =
      await this.dataSource.query(
        `SELECT u.id AS "userId", ${displayName('u')} AS name, u.mobile, u."accountCode", i.token, i."usedAt", i."createdAt",
           (SELECT COUNT(*)::int FROM "CargoRequest" r WHERE r."driverUserId" = u.id AND r."companyUserId" = i."companyUserId") AS requests
         FROM "BrokerInvite" i JOIN "User" u ON u.id = i."brokerUserId"
         WHERE i."companyUserId" = $1 AND i."revokedAt" IS NULL
         ORDER BY i."createdAt" DESC`,
        [companyUserId],
      );
    // a broker whose invite's day is over without it coming in is gone already, even before the sweep
    return rows.filter((row) => !isInviteExpired(row)).map((row) => ({ ...row, joinedAt: row.createdAt, expiresAt: inviteExpiresAt(row) }));
  }

  /** شرکت واسط را از لیستش برمی‌دارد: دعوت باطل و شرکت از انتخاب‌های واسط بیرون می‌رود. حساب واسط می‌ماند. */
  async remove(companyUserId: string, brokerUserId: string): Promise<{ brokerUserId: string }> {
    const result = await this.invites.update({ companyUserId, brokerUserId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw new NotFoundException('این واسط در لیست شما نیست.');
    await this.access.dropCompany(brokerUserId, companyUserId);
    return { brokerUserId };
  }

  //#endregion

  //#region ----------- The invited broker -----------------------------------------

  /** صفحه‌ی لینک دعوت (بی‌ورود): شرکت دعوت‌کننده و شماره‌ی دعوت‌شده (پوشیده). */
  async info(token: string): Promise<{ valid: boolean; companyName: string | null; mobile: string | null }> {
    const invite = await this.activeInvite(token);
    if (!invite) return { valid: false, companyName: null, mobile: null };
    return { valid: true, companyName: await this.name(invite.companyUserId), mobile: maskMobile(invite.mobile) };
  }

  /** The account that came in with the link is the invited broker (same number)? Marks the link used. */
  async isInvited(userId: string, token: string): Promise<boolean> {
    const invite = await this.activeInvite(token);
    if (!invite || invite.brokerUserId !== userId) return false;
    if (!invite.usedAt) await this.invites.update({ id: invite.id }, { usedAt: new Date() });
    return true;
  }

  /** ربات‌ها و واتساپ، بعد از اینکه شماره معلوم شد: خوشامد، یا اینکه دعوت برای شماره‌ی دیگری است. */
  async welcome(userId: string, token: string): Promise<BrokerInviteResult> {
    const invite = await this.activeInvite(token);
    if (!invite) return { status: 'invalid' };
    if (!(await this.isInvited(userId, token))) return { status: 'otherNumber' };
    return { status: 'joined', companyName: await this.name(invite.companyUserId) };
  }

  //#endregion

  private activeInvite(token: string): Promise<BrokerInvite | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Promise.resolve(null);
    // an invite past its day: its link no longer works, even before the sweep revokes it
    return this.invites.findOne({ where: { token, revokedAt: IsNull() } }).then((invite) => (invite && !isInviteExpired(invite) ? invite : null));
  }

  private async name(userId: string): Promise<string> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    return user?.companyName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.mobile || 'شرکت حمل‌ونقل';
  }
}

const displayName = (alias: string) =>
  `COALESCE(NULLIF(${alias}."companyName", ''), NULLIF(concat_ws(' ', ${alias}."firstName", ${alias}."lastName"), ''), ${alias}.mobile, ${alias}.username)`;
