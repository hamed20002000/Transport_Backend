import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { RedisService } from '../redis/redis.service';
import { AccountVerificationEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { COMPANY_ROLES, CompanyFeatureService } from './companyFeature.service';
import { InviteSmsService } from './inviteSms.service';

export type VerificationStatus = User['verificationStatus'];

/** the first request and up to three more after correcting a rejected profile */
export const MAX_VERIFICATION_REQUESTS = 4;

const FACTORY_ROLE = 'FACTORY';
const BROKER_ROLE = 'BROKER';

/** The kinds of account a parent company checks; a broker requests loads like a driver. */
export type VerifiedKind = 'COMPANY' | 'FACTORY' | 'BROKER';

export function verifiedKind(roles: Array<string | undefined>): VerifiedKind {
  if (roles.includes(FACTORY_ROLE)) return 'FACTORY';
  if (roles.includes(BROKER_ROLE)) return 'BROKER';
  return 'COMPANY';
}

const kindOf = (user: User) => verifiedKind((user.userRoles ?? []).map((item) => item.role?.name));

/** Where each kind fills in its profile and asks (web panel). */
export const VERIFICATION_PROFILE_PATH: Record<VerifiedKind, string> = {
  COMPANY: '/account/company/profile',
  FACTORY: '/account/factory',
  BROKER: '/account/broker',
};

/**
 * What the parent company checks an account with before approving it: a transport company by its trade name,
 * economic code and phone; a factory and a broker by name and phone. The other profile fields help but are not required.
 */
const REQUIRED_FIELDS: Record<VerifiedKind, Array<{ key: keyof User; title: string }>> = {
  COMPANY: [
    { key: 'companyName', title: 'نام تجاری شرکت' },
    { key: 'economicCode', title: 'کد اقتصادی' },
    { key: 'phone', title: 'شماره شرکت' },
  ],
  FACTORY: [
    { key: 'companyName', title: 'نام کارخانه' },
    { key: 'phone', title: 'شماره کارخانه' },
  ],
  BROKER: [
    { key: 'companyName', title: 'نام واسط یا دفتر' },
    { key: 'phone', title: 'شماره تماس' },
  ],
};

const NOUN: Record<VerifiedKind, string> = { COMPANY: 'شرکت', FACTORY: 'کارخانه', BROKER: 'واسط' };
const REQUIRED_TEXT: Record<VerifiedKind, string> = {
  COMPANY: 'نام تجاری، کد اقتصادی و شماره‌ی شرکت',
  FACTORY: 'نام و شماره‌ی کارخانه',
  BROKER: 'نام و شماره‌ی تماس',
};
const PROFILE_FIELDS = ['companyName', 'companyNationalId', 'economicCode', 'registrationNo', 'phone', 'postalCode', 'address'] as const;

export interface VerificationState {
  /** NONE: fill in the profile and ask; PENDING: waiting for the parent company; APPROVED; REJECTED */
  status: VerificationStatus;
  /** the button «درخواست بررسی اعتبار» is shown (not after approval, nor once the requests ran out) */
  canRequest: boolean;
  /** requests left, counting this one */
  remaining: number;
  /** the profile fields still empty before a request can be sent */
  missing: string[];
  note: string | null;
  requestedAt: Date | null;
  decidedAt: Date | null;
}

/**
 * بررسی اعتبار شرکت حمل‌ونقل، کارخانه و واسطی که خودش ثبت‌نام کرده (حساب دعوت‌شده از قبل تأییدشده است): پروفایل را
 * پر می‌کند و درخواست می‌دهد، شرکت مادر با همان اطلاعات استعلام می‌کند و تأیید یا (با دلیل) رد می‌کند. رد شده
 * می‌تواند اصلاح کند و دوباره بخواهد، روی هم MAX_VERIFICATION_REQUESTS بار. تأییدشده به روال عادی برمی‌گردد:
 * شرکت مثل شرکت دعوت‌شده‌ی همان شرکت مادر (همه‌ی بخش‌ها تا خرید قفل)، کارخانه عضو شرکت مادر.
 */
@Injectable()
export class AccountVerificationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly features: CompanyFeatureService,
    private readonly redis: RedisService,
    private readonly sms: InviteSmsService,
  ) {}

  /** تأیید شده است (هر حسابی جز شرکت و کارخانه‌ی خودثبت‌نام‌کرده‌ی تأییدنشده). */
  async isApproved(userId: string): Promise<boolean> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, verificationStatus: true } });
    return !user || user.verificationStatus === 'APPROVED';
  }

  async state(userId: string): Promise<VerificationState> {
    const user = await this.users.findOne({ where: { id: userId }, relations: { userRoles: { role: true } } });
    if (!user) throw new NotFoundException('حساب پیدا نشد.');
    const remaining = Math.max(0, MAX_VERIFICATION_REQUESTS - user.verificationRequests);
    const missing = REQUIRED_FIELDS[kindOf(user)].filter(({ key }) => !String(user[key] ?? '').trim()).map(({ title }) => title);
    return {
      status: user.verificationStatus,
      canRequest: (user.verificationStatus === 'NONE' || user.verificationStatus === 'REJECTED') && remaining > 0,
      remaining,
      missing,
      note: user.verificationNote ?? null,
      requestedAt: user.verificationRequestedAt ?? null,
      decidedAt: user.verificationDecidedAt ?? null,
    };
  }

  /**
   * ربات‌ها و واتساپ (به‌جای منو) برای حسابی که هنوز تأیید نشده: وضعیت و راه ادامه (پروفایل و درخواست در پنل وب)؛
   * null برای حساب تأییدشده.
   */
  async messengerNotice(userId: string): Promise<string | null> {
    const user = await this.users.findOne({ where: { id: userId }, relations: { userRoles: { role: true } } });
    if (!user || user.verificationStatus === 'APPROVED') return null;
    const kind = kindOf(user);
    const panel = this.sms.panelUrl();
    const where = panel ? `\n${panel}${VERIFICATION_PROFILE_PATH[kind]}` : '';
    const { remaining } = await this.state(userId);
    if (user.verificationStatus === 'PENDING') {
      return '⏳ درخواست بررسی اعتبار شما در انتظار تأیید شرکت مادر است. نتیجه همین‌جا اعلام می‌شود و بعد از تأیید، منوی کامل باز می‌شود.';
    }
    if (user.verificationStatus === 'REJECTED') {
      const reason = `دلیل: ${user.verificationNote ?? '—'}`;
      return remaining
        ? `❌ درخواست بررسی اعتبار شما تأیید نشد.\n${reason}\n\nاطلاعات پروفایل را در پنل وب اصلاح کنید و دوباره «درخواست بررسی اعتبار» را بزنید (${remaining} بار دیگر).${where}`
        : `❌ درخواست بررسی اعتبار شما تأیید نشد و دفعات درخواست تمام شده است.\n${reason}\n\nبرای پیگیری با پشتیبانی تماس بگیرید.`;
    }
    return `🏢 حساب شما ساخته شد و تا تأیید شرکت مادر فعال نیست.\n\nدر پنل وب با همین شماره وارد شوید، پروفایل ${NOUN[kind]} را کامل کنید (${REQUIRED_TEXT[kind]}) و «درخواست بررسی اعتبار» را بزنید.${where}`;
  }

  /** «درخواست بررسی اعتبار»: پروفایل کامل، و هنوز درخواستی باقی مانده. */
  async request(userId: string): Promise<VerificationState> {
    const state = await this.state(userId);
    if (state.status === 'APPROVED') throw new ConflictException('حساب شما تأیید شده است.');
    if (state.status === 'PENDING') throw new ConflictException('درخواست شما در حال بررسی است.');
    if (!state.canRequest) throw new ForbiddenException('دفعات درخواست بررسی شما تمام شده است؛ با پشتیبانی تماس بگیرید.');
    if (state.missing.length) throw new BadRequestException(`اول این‌ها را در پروفایل پر کنید: ${state.missing.join('، ')}.`);
    const now = new Date();
    const result = await this.users
      .createQueryBuilder()
      .update(User)
      .set({ verificationStatus: 'PENDING', verificationRequests: () => '"verificationRequests" + 1', verificationRequestedAt: now, verificationNote: null })
      .where('id = :userId AND "verificationStatus" IN (:...open)', { userId, open: ['NONE', 'REJECTED'] })
      .execute();
    if (!result.affected) throw new ConflictException('درخواست شما در حال بررسی است.');
    await this.announce(REDIS_CHANNELS.accountVerificationRequested, { userId, name: await this.name(userId) });
    return this.state(userId);
  }

  //#region ----------- Parent company ----------------------------------------------

  /** درخواست‌ها برای شرکت مادر: پیش‌فرض در انتظار؛ با همه‌ی اطلاعات پروفایل برای استعلام. */
  async list(parentUserId: string, statuses: VerificationStatus[] = ['PENDING']) {
    await this.assertParent(parentUserId);
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT DISTINCT u.id AS "userId", u.mobile, u."verificationStatus" AS status, u."verificationRequests" AS requests,
         u."verificationNote" AS note, u."verificationRequestedAt" AS "requestedAt", u."verificationDecidedAt" AS "decidedAt",
         u."createdAt", ${PROFILE_FIELDS.map((field) => `u."${field}"`).join(', ')},
         CASE WHEN bool_or(r.name = '${FACTORY_ROLE}') THEN 'FACTORY' WHEN bool_or(r.name = '${BROKER_ROLE}') THEN 'BROKER' ELSE 'COMPANY' END AS kind
       FROM "User" u
       JOIN "UserRole" ur ON ur."userId" = u.id
       JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $2 AND r.name = ANY($3::text[])
       WHERE u."verificationStatus" = ANY($1::text[]) AND u."recordStatus" = $2
       GROUP BY u.id
       ORDER BY u."verificationRequestedAt" DESC NULLS LAST`,
      [statuses, RecordStatus.Active, [...COMPANY_ROLES, FACTORY_ROLE, BROKER_ROLE]],
    );
    return rows.map((row) => ({ ...row, remaining: Math.max(0, MAX_VERIFICATION_REQUESTS - Number(row.requests)) }));
  }

  /**
   * تأیید: حساب فعال می‌شود و به روال عادی برمی‌گردد. شرکت حمل‌ونقل دعوت‌شده‌ی همین شرکت مادر حساب می‌شود (همه‌ی
   * بخش‌ها تا خرید قفل)؛ کارخانه عضو همین شرکت مادر می‌شود و بارش را برای آن می‌فرستد؛ واسط فقط فعال می‌شود.
   */
  async approve(parentUserId: string, userId: string) {
    await this.assertParent(parentUserId);
    const kind = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId }, relations: { userRoles: { role: true } }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('حساب پیدا نشد.');
      if (user.verificationStatus !== 'PENDING') throw new ConflictException('این درخواست در انتظار بررسی نیست.');
      const kind = kindOf(user);
      await manager.update(User, { id: userId }, {
        verificationStatus: 'APPROVED',
        verificationDecidedAt: new Date(),
        verificationDecidedBy: parentUserId,
        verificationNote: null,
        ...(kind === 'COMPANY' ? { invitedByCompanyUserId: parentUserId } : {}),
      });
      if (kind === 'FACTORY') {
        await manager.query(
          `INSERT INTO "FactoryCompany" ("factoryUserId", "companyUserId") VALUES ($1, $2) ON CONFLICT ("factoryUserId", "companyUserId") DO NOTHING`,
          [userId, parentUserId],
        );
      }
      return kind;
    });
    await this.announce(REDIS_CHANNELS.accountVerificationDecided, { userId, name: await this.name(userId), approved: true, kind });
    return { userId, status: 'APPROVED' as const };
  }

  /** رد با دلیل؛ اگر درخواستی باقی مانده باشد کاربر اصلاح می‌کند و دوباره می‌خواهد. */
  async reject(parentUserId: string, userId: string, reason: string) {
    await this.assertParent(parentUserId);
    const result = await this.users.update(
      { id: userId, verificationStatus: 'PENDING' },
      { verificationStatus: 'REJECTED', verificationNote: reason, verificationDecidedAt: new Date(), verificationDecidedBy: parentUserId },
    );
    if (!result.affected) throw new ConflictException('این درخواست در انتظار بررسی نیست.');
    const { remaining } = await this.state(userId);
    await this.announce(REDIS_CHANNELS.accountVerificationDecided, { userId, name: await this.name(userId), approved: false, reason, remaining });
    return { userId, status: 'REJECTED' as const, remaining };
  }

  /** شرکت‌های مادر (برای خبر دادن درخواست تازه). */
  async parentIds(): Promise<string[]> {
    const rows = await this.users.find({ where: { isParentCompany: true, recordStatus: RecordStatus.Active }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  //#endregion

  private async assertParent(userId: string): Promise<void> {
    if (!(await this.features.isParent(userId))) throw new ForbiddenException('فقط شرکت مادر درخواست‌های بررسی اعتبار را می‌بیند.');
  }

  private async name(userId: string): Promise<string> {
    const user = await this.users.findOne({ where: { id: userId } });
    return user?.companyName?.trim() || user?.mobile || 'حساب';
  }

  /** The parent companies (a new request) or the account (a decision) hear of it through SubscriptionNotifier. */
  private async announce(channel: string, event: AccountVerificationEvent): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(event)).catch(() => undefined);
  }
}
