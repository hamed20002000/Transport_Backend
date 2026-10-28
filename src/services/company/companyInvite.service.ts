import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Role } from 'src/domain/entities/auth/Role';
import { User } from 'src/domain/entities/auth/User';
import { UserRole } from 'src/domain/entities/auth/UserRole';
import { CompanyInvite } from 'src/domain/entities/company/CompanyInvite';
import { CustomerType } from 'src/domain/enums/company.enum';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { CompanyFeatureService } from './companyFeature.service';
import { InviteSmsService } from './inviteSms.service';

const currencyNames: Record<string, string> = { IRR: 'ریال', IRT: 'تومان', GBP: 'پوند', EUR: 'یورو', SAR: 'ریال سعودی', CNY: 'یوان' };
const fa = (value: number | string) => Number(value).toLocaleString('fa-IR');

export type CompanyWelcomeResult =
  /** welcome: the menus, their prices and how to buy them */
  | { status: 'joined'; parentName: string; welcome: string }
  | { status: 'invalid' }
  /** the account that opened the link is not the number the parent company invited */
  | { status: 'otherNumber' };

/** 0912***4567: the invite page shows which number is invited without giving it away. */
export const maskMobile = (mobile: string) => `${mobile.slice(0, 4)}***${mobile.slice(-4)}`;

/**
 * شرکت مادر یک شرکت حمل‌ونقل را با شماره‌اش دعوت می‌کند: حساب شرکت همان لحظه ساخته می‌شود (تأییدشده از طرف شرکت
 * مادر، «دعوت‌شده»: همه‌ی بخش‌ها تا خرید قفل)، پس شرکت با همان شماره و کد پیامکی وارد وب می‌شود یا شماره‌اش را در
 * ربات‌ها و واتساپ می‌دهد. لینک و کد فقط برای همان شماره کار می‌کنند. جدا از لینک دعوت کارخانه.
 */
@Injectable()
export class CompanyInviteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CompanyInvite) private readonly invites: Repository<CompanyInvite>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly features: CompanyFeatureService,
    private readonly sms: InviteSmsService,
  ) {}

  //#region ----------- Parent company ----------------------------------------------

  /**
   * The company's account with this number, ready to sign in to. A number that already has an account is refused
   * (a company signed up on its own would otherwise find every menu locked); one with no role yet (opened a bot
   * before) becomes this company. Inviting the same number again gives back its invite.
   */
  async create(parentUserId: string, mobileInput: string, companyName?: string | null) {
    await this.assertParent(parentUserId);
    const mobile = normalizePhoneNumber(mobileInput);
    if (typeof mobile !== 'string' || !/^09[0-9]{9}$/.test(mobile)) throw new BadRequestException('شماره موبایل معتبر نیست؛ مثلاً 09121234567.');
    const name = companyName?.trim() || null;

    const invite = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(User, { where: { mobile }, relations: { userRoles: { role: true } } });
      if (existing) {
        const again = await manager.findOne(CompanyInvite, { where: { companyUserId: existing.id, parentUserId } });
        if (again) return again;
        if (existing.userRoles?.length) throw new ConflictException('این شماره از قبل در سامانه حساب دارد و نمی‌شود آن را دعوت کرد.');
      }
      const role = await manager.findOne(Role, { where: { name: 'COMPANY', recordStatus: RecordStatus.Active } });
      if (!role) throw new BadRequestException('نقش شرکت در سامانه تعریف نشده است.');
      const company = existing ?? manager.create(User, { username: mobile, mobile, recordStatus: RecordStatus.Active });
      company.invitedByCompanyUserId = parentUserId;
      if (name) Object.assign(company, { companyName: name, profileType: CustomerType.Company });
      const saved = await manager.save(User, company);
      await manager.save(UserRole, manager.create(UserRole, { userId: saved.id, roleId: role.id }));
      return manager.save(CompanyInvite, manager.create(CompanyInvite, { parentUserId, companyUserId: saved.id, mobile, token: randomBytes(18).toString('base64url') }));
    });
    const panel = this.sms.panelUrl();
    const sms = panel
      ? await this.sms.sendOne(invite.mobile, `حساب شرکت حمل‌ونقل شما را «${await this.name(parentUserId)}» در ترابوت ساخته است.\nورود با همین شماره:\n${panel}/join/${invite.token}`)
      : { status: 'notConfigured' as const, count: 1 };
    return { ...this.view(invite, name ?? (await this.name(invite.companyUserId))), sms };
  }

  /** دعوت‌های این شرکت مادر، جدیدترین اول، با وضعیت ورود و تعداد بخش‌های باز هر شرکت. */
  async list(parentUserId: string) {
    await this.assertParent(parentUserId);
    const rows: Array<{ token: string; mobile: string; usedAt: Date | null; createdAt: Date; companyUserId: string; name: string; openFeatures: number }> = await this.dataSource.query(
      `SELECT i.token, i.mobile, i."usedAt", i."createdAt", i."companyUserId", ${displayName('u')} AS name,
         (SELECT COUNT(DISTINCT g.feature)::int FROM "CompanyFeatureGrant" g
           WHERE g."userId" = u.id AND g."startAt" <= now() AND g."expireAt" > now()) AS "openFeatures"
       FROM "CompanyInvite" i JOIN "User" u ON u.id = i."companyUserId"
       WHERE i."parentUserId" = $1 AND i."revokedAt" IS NULL
       ORDER BY i."createdAt" DESC`,
      [parentUserId],
    );
    return rows;
  }

  //#endregion

  //#region ----------- The invited company --------------------------------------

  /** صفحه‌ی لینک (بی‌ورود): شرکت مادر و شماره‌ی دعوت‌شده (پوشیده). */
  async info(token: string): Promise<{ valid: boolean; parentName: string | null; mobile: string | null }> {
    const invite = await this.activeInvite(token);
    if (!invite) return { valid: false, parentName: null, mobile: null };
    return { valid: true, parentName: await this.name(invite.parentUserId), mobile: maskMobile(invite.mobile) };
  }

  /** The account that came in with the link is the invited one (same number)? Marks the link used. */
  async isMember(userId: string, token: string): Promise<boolean> {
    const invite = await this.activeInvite(token);
    if (!invite || invite.companyUserId !== userId) return false;
    if (!invite.usedAt) await this.invites.update({ id: invite.id }, { usedAt: new Date() });
    return true;
  }

  /** ربات‌ها و واتساپ، بعد از اینکه شماره معلوم شد: خوشامد با بخش‌ها و قیمت‌ها، یا اینکه شماره‌ی دیگری است. */
  async welcome(userId: string, token: string): Promise<CompanyWelcomeResult> {
    const invite = await this.activeInvite(token);
    if (!invite) return { status: 'invalid' };
    if (!(await this.isMember(userId, token))) return { status: 'otherNumber' };
    const parentName = await this.name(invite.parentUserId);
    return { status: 'joined', parentName, welcome: await this.welcomeText(userId, parentName) };
  }

  /** پیام خوشامد ربات‌ها و واتساپ: بخش‌ها، قیمت هر کدام و راه خرید. */
  async welcomeText(userId: string, parentName: string): Promise<string> {
    const { features } = await this.features.status(userId);
    const lines = features.map((item) => {
      const cheapest = [...item.plans].sort((a, b) => Number(a.price) - Number(b.price))[0];
      const price = cheapest
        ? `از ${fa(cheapest.price)} ${currencyNames[cheapest.currency] ?? cheapest.currency} برای ${fa(cheapest.durationDays)} روز`
        : 'هنوز قیمت‌گذاری نشده';
      return `${item.locked ? '🔒' : '✅'} ${item.title} — ${price}`;
    });
    return [
      `🏢 به سامانه خوش آمدید؛ حساب شرکت حمل‌ونقل شما را «${parentName}» ساخته است.`,
      'بخش‌های پنل شرکت حمل‌ونقل تا وقتی آن‌ها را نخرید فعال نمی‌شوند:',
      lines.join('\n'),
      'برای خرید، «💎 خرید امکانات» را در منو بزنید (کارت‌به‌کارت و ارسال عکس رسید) یا از پنل وب بخرید. بعد از تأیید رسید، همان بخش باز می‌شود.',
    ].join('\n\n');
  }

  //#endregion

  private activeInvite(token: string): Promise<CompanyInvite | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Promise.resolve(null);
    return this.invites.findOne({ where: { token, revokedAt: IsNull() } });
  }

  private view(invite: CompanyInvite, name: string) {
    return { token: invite.token, mobile: invite.mobile, usedAt: invite.usedAt ?? null, createdAt: invite.createdAt, companyUserId: invite.companyUserId, name, openFeatures: 0 };
  }

  private async assertParent(userId: string): Promise<void> {
    if (!(await this.features.isParent(userId))) throw new ForbiddenException('فقط شرکت مادر می‌تواند شرکت دعوت کند.');
  }

  private async name(userId: string): Promise<string> {
    const user = await this.users.findOne({ where: { id: userId } });
    return user?.companyName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.mobile || 'شرکت حمل‌ونقل';
  }
}


const displayName = (alias: string) =>
  `COALESCE(NULLIF(${alias}."companyName", ''), NULLIF(concat_ws(' ', ${alias}."firstName", ${alias}."lastName"), ''), ${alias}.mobile, ${alias}.username)`;
