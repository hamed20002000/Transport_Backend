import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Role } from 'src/domain/entities/auth/Role';
import { User } from 'src/domain/entities/auth/User';
import { UserRole } from 'src/domain/entities/auth/UserRole';
import { CustomerType } from 'src/domain/enums/company.enum';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { maskMobile } from './companyInvite.service';
import { InviteSmsService } from './inviteSms.service';
import { FactoryCargo } from 'src/domain/entities/company/FactoryCargo';
import { FactoryCompany } from 'src/domain/entities/company/FactoryCompany';
import { FactoryInvite } from 'src/domain/entities/company/FactoryInvite';
import { CargoDetectedEvent } from 'src/domain/constants/cargoEvents';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { CargoAudienceRepository, COMPANY_ROLES } from 'src/infrastructure/repositories/notification/cargoAudience.repository';
import { CargoExcelService, ExcelCargoError, ExcelCargoRow } from '../notification/cargoExcel.service';
import { FactoryInviteResult } from '../messengerBot/core/factoryInvite';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { CompanyFeatureService } from './companyFeature.service';
import { CargoNotificationService } from '../notification/cargoNotification.service';

export const FACTORY_ROLE = 'FACTORY';

/** فیلدهای باری که کارخانه می‌فرستد (همان فرم «ثبت بار» شرکت، بی‌نام شرکت). */
export interface FactoryCargoInput {
  origin: string;
  destination: string;
  cargoType?: string | null;
  weight?: string | null;
  vehicleType?: string | null;
  price?: string | null;
  extraNotes?: string | null;
  contactPhones: string[];
  photo?: string | null;
}

/**
 * کارخانه (صاحب بار) به‌جای تماس با شرکت حمل‌ونقل، با دعوت شخصی همان شرکت (با شماره‌ی کارخانه؛ حسابش همان لحظه
 * ساخته می‌شود) عضو می‌شود و بارش را برای یکی از شرکت‌هایی که دعوتش کرده‌اند می‌فرستد؛ بار در «پیشنهادها»ی آن شرکت می‌نشیند و شرکت آن را به نام خودش برای
 * رانندگان اعلام می‌کند. کارخانه جز ثبت بار (تکی یا با اکسل) کاری ندارد.
 */
@Injectable()
export class FactoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(FactoryInvite) private readonly invites: Repository<FactoryInvite>,
    @InjectRepository(FactoryCompany) private readonly memberships: Repository<FactoryCompany>,
    @InjectRepository(FactoryCargo) private readonly cargo: Repository<FactoryCargo>,
    private readonly audience: CargoAudienceRepository,
    private readonly notifications: CargoNotificationService,
    private readonly excel: CargoExcelService,
    private readonly features: CompanyFeatureService,
    private readonly sms: InviteSmsService,
  ) {}

  //#region ----------- Invite (company side) -------------------------------------

  /**
   * The company invites a factory by its number: the factory's account is made right away (or, already a factory
   * of another company, only gets this one added) and joins the company's list, approved by it. The link (/invite/…)
   * and code (inv_…) only let that number sign in. A number of a driver or a company is refused.
   */
  async createInvite(companyUserId: string, mobileInput: string, factoryName?: string | null) {
    const mobile = normalizePhoneNumber(mobileInput);
    if (typeof mobile !== 'string' || !/^09[0-9]{9}$/.test(mobile)) throw new BadRequestException('شماره موبایل معتبر نیست؛ مثلاً 09121234567.');
    const name = factoryName?.trim() || null;

    const invite = await this.dataSource.transaction(async (manager) => {
      let factory = await manager.findOne(User, { where: { mobile }, relations: { userRoles: { role: true } } });
      const roles = factory?.userRoles?.filter((item) => item.role?.recordStatus === RecordStatus.Active).map((item) => item.role.name) ?? [];
      if (roles.length && !roles.includes(FACTORY_ROLE)) throw new ConflictException('این شماره حساب راننده یا شرکت است و نمی‌شود آن را کارخانه دعوت کرد.');
      if (!roles.length) {
        const role = await manager.findOne(Role, { where: { name: FACTORY_ROLE, recordStatus: RecordStatus.Active } });
        if (!role) throw new BadRequestException('نقش کارخانه در سامانه تعریف نشده است.');
        factory = factory ?? manager.create(User, { username: mobile, mobile, recordStatus: RecordStatus.Active });
        if (name) Object.assign(factory, { companyName: name, profileType: CustomerType.Company });
        factory = await manager.save(User, factory);
        await manager.save(UserRole, manager.create(UserRole, { userId: factory.id, roleId: role.id }));
      }
      const factoryUserId = factory!.id;
      // a factory that signed up on its own and is not checked yet: the company inviting it vouches for it
      if (roles.length && factory!.verificationStatus !== 'APPROVED') {
        await manager.update(User, { id: factoryUserId }, { verificationStatus: 'APPROVED', verificationDecidedAt: new Date(), verificationDecidedBy: companyUserId });
      }
      await manager.createQueryBuilder().insert().into(FactoryCompany).values({ factoryUserId, companyUserId }).orIgnore().execute();
      const existing = await manager.findOne(FactoryInvite, { where: { companyUserId, factoryUserId } });
      return existing ?? manager.save(FactoryInvite, manager.create(FactoryInvite, { companyUserId, factoryUserId, mobile, token: newToken() }));
    });
    const panel = this.sms.panelUrl();
    const sms = panel
      ? await this.sms.sendOne(invite.mobile, `«${await this.companyName(companyUserId)}» شما را برای ثبت بار دعوت کرده است؛ بارتان مستقیم به این شرکت می‌رسد.\nورود با همین شماره:\n${panel}/invite/${invite.token}`)
      : { status: 'notConfigured' as const, count: 1 };
    return { token: invite.token, mobile: invite.mobile, factoryUserId: invite.factoryUserId, usedAt: invite.usedAt ?? null, name: name ?? (await this.companyName(invite.factoryUserId)), sms };
  }

  /** کارخانه‌های عضو این شرکت، جدیدترین اول، با دعوت هر کدام و تعداد بارهایی که فرستاده‌اند. */
  async factoriesOf(companyUserId: string) {
    const rows: Array<{ userId: string; name: string; mobile: string | null; joinedAt: Date; loads: number; token: string | null; usedAt: Date | null }> = await this.dataSource.query(
      `SELECT u.id AS "userId", ${displayName('u')} AS name, u.mobile, fc."createdAt" AS "joinedAt",
         (SELECT COUNT(*)::int FROM "FactoryCargo" c WHERE c."factoryUserId" = u.id AND c."companyUserId" = fc."companyUserId") AS loads,
         i.token, i."usedAt"
       FROM "FactoryCompany" fc JOIN "User" u ON u.id = fc."factoryUserId"
       LEFT JOIN "FactoryInvite" i ON i."companyUserId" = fc."companyUserId" AND i."factoryUserId" = fc."factoryUserId" AND i."revokedAt" IS NULL
       WHERE fc."companyUserId" = $1
       ORDER BY fc."createdAt" DESC`,
      [companyUserId],
    );
    return rows;
  }

  /** شرکت کارخانه را از لیستش برمی‌دارد؛ دعوتش هم باطل می‌شود. حساب کارخانه می‌ماند (شاید عضو شرکت‌های دیگر باشد). */
  async removeFactory(companyUserId: string, factoryUserId: string): Promise<{ factoryUserId: string }> {
    const result = await this.memberships.delete({ companyUserId, factoryUserId });
    if (!result.affected) throw new NotFoundException('این کارخانه در لیست شما نیست.');
    await this.invites.update({ companyUserId, factoryUserId, revokedAt: IsNull() }, { revokedAt: new Date() });
    return { factoryUserId };
  }

  //#endregion

  //#region ----------- Invite (factory side) -------------------------------------

  /** صفحه‌ی لینک دعوت (بی‌ورود): شرکت دعوت‌کننده و شماره‌ی دعوت‌شده (پوشیده)، یا اینکه لینک معتبر نیست. */
  async inviteInfo(token: string): Promise<{ valid: boolean; companyName: string | null; mobile: string | null }> {
    const invite = await this.activeInvite(token);
    if (!invite) return { valid: false, companyName: null, mobile: null };
    return { valid: true, companyName: await this.companyName(invite.companyUserId), mobile: maskMobile(invite.mobile) };
  }

  /** The account that came in with the link is the invited factory (same number)? Marks the link used. */
  async isInvited(userId: string, token: string): Promise<boolean> {
    const invite = await this.activeInvite(token);
    if (!invite || invite.factoryUserId !== userId) return false;
    if (!invite.usedAt) await this.invites.update({ id: invite.id }, { usedAt: new Date() });
    return true;
  }

  /** ربات‌ها و واتساپ، بعد از اینکه شماره معلوم شد: خوشامد، یا اینکه دعوت برای شماره‌ی دیگری است. */
  async welcome(userId: string, token: string): Promise<FactoryInviteResult> {
    const invite = await this.activeInvite(token);
    if (!invite) return { status: 'invalid' };
    if (!(await this.isInvited(userId, token))) return { status: 'otherNumber' };
    return { status: 'joined', companyName: await this.companyName(invite.companyUserId) };
  }

  /** شرکت‌هایی که کارخانه می‌تواند برایشان بار بفرستد (فقط شرکت‌های هنوز فعال). */
  async companies(factoryUserId: string): Promise<Array<{ userId: string; name: string }>> {
    const rows: Array<{ userId: string; name: string }> = await this.dataSource.query(
      `SELECT DISTINCT u.id AS "userId", ${displayName('u')} AS name, fc."createdAt"
       FROM "FactoryCompany" fc
       JOIN "User" u ON u.id = fc."companyUserId" AND u."recordStatus" = $2
       JOIN "UserRole" ur ON ur."userId" = u.id
       JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $2 AND r.name = ANY($3::text[])
       WHERE fc."factoryUserId" = $1
       ORDER BY fc."createdAt"`,
      [factoryUserId, RecordStatus.Active, COMPANY_ROLES],
    );
    // a company whose «کارخانه‌ها» menu is locked (not bought, or ran out) takes no loads from factories until it buys it
    const open = await Promise.all(rows.map((row) => this.hasFactories(row.userId)));
    return rows.filter((_, i) => open[i]).map(({ userId, name }) => ({ userId, name }));
  }

  /** The «کارخانه‌ها» menu (CompanyFeature): parent companies and free or bought ones have it. */
  private hasFactories(companyUserId: string): Promise<boolean> {
    return this.features.hasFeature(companyUserId, CompanyFeature.Factories);
  }

  //#endregion

  //#region ----------- Loads ------------------------------------------------------

  /** نام و شماره‌های کارخانه برای فرم ثبت بار. */
  async draft(factoryUserId: string): Promise<{ factoryName: string | null; contactPhones: string[] }> {
    const factory = await this.factory(factoryUserId);
    return { factoryName: factory.name, contactPhones: factory.phones };
  }

  async send(factoryUserId: string, companyUserId: string, input: FactoryCargoInput) {
    await this.assertMember(factoryUserId, companyUserId);
    const saved = await this.save(factoryUserId, companyUserId, input, await this.factory(factoryUserId));
    return this.view(saved);
  }

  /** همه‌ی ردیف‌ها اول بررسی می‌شوند؛ اگر یکی ایراد داشت هیچ باری فرستاده نمی‌شود (مثل اکسل شرکت). */
  async importExcel(factoryUserId: string, companyUserId: string, file: Buffer, dryRun = false) {
    const { rows, errors } = await this.checkExcel(factoryUserId, companyUserId, file);
    if (errors.length || dryRun) {
      return { created: [], rows: rows.map(({ row, fields }) => ({ row, ...fields })), errors, dryRun };
    }
    return { created: await this.sendRows(factoryUserId, companyUserId, rows), rows: [], errors: [], dryRun };
  }

  /** بررسی فایل بی‌ارسال؛ شماره تماس خالی با شماره‌های کارخانه پر می‌شود. */
  async checkExcel(factoryUserId: string, companyUserId: string, file: Buffer): Promise<{ rows: ExcelCargoRow[]; errors: ExcelCargoError[] }> {
    await this.assertMember(factoryUserId, companyUserId);
    return this.excel.parse(file, (await this.factory(factoryUserId)).phones);
  }

  /** ردیف‌های بررسی‌شده، هر کدام یک بار در پیشنهادهای شرکت. */
  async sendRows(factoryUserId: string, companyUserId: string, rows: ExcelCargoRow[]) {
    await this.assertMember(factoryUserId, companyUserId);
    const factory = await this.factory(factoryUserId);
    const created: Array<{ row: number; id: string; origin: string; destination: string }> = [];
    for (const { row, fields } of rows) {
      const saved = await this.save(factoryUserId, companyUserId, { ...fields, contactPhones: fields.contactPhones ?? [] }, factory);
      created.push({ row, id: saved.id, origin: saved.origin, destination: saved.destination });
    }
    return created;
  }

  /** بارهایی که کارخانه فرستاده، جدیدترین اول، با نام شرکت گیرنده. */
  async myLoads(factoryUserId: string, page: number, pageSize: number) {
    const [items, total] = await this.cargo.findAndCount({
      where: { factoryUserId },
      relations: { company: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: items.map((item) => this.view(item)), total, page, pageSize };
  }

  private async save(factoryUserId: string, companyUserId: string, input: FactoryCargoInput, factory: { name: string; phones: string[] }) {
    const saved = await this.cargo.save(
      this.cargo.create({
        factoryUserId,
        companyUserId,
        origin: input.origin,
        destination: input.destination,
        cargoType: input.cargoType || null,
        weight: input.weight || null,
        vehicleType: input.vehicleType || null,
        price: input.price || null,
        extraNotes: input.extraNotes || null,
        contactPhones: input.contactPhones,
        photo: input.photo || null,
      }),
    );
    const event: CargoDetectedEvent = {
      messageId: `factory:${saved.id}`,
      rawText: '',
      receivedAt: saved.createdAt.toISOString(),
      origin: saved.origin,
      destination: saved.destination,
      cargoType: saved.cargoType ?? null,
      weight: saved.weight ?? null,
      vehicleType: saved.vehicleType ?? null,
      price: saved.price ?? null,
      extraNotes: saved.extraNotes ?? null,
      processedText: null,
      ownerUserIds: [],
      photo: saved.photo ?? null,
    };
    await this.notifications.suggestFactoryCargo(companyUserId, event, { userId: factoryUserId, name: factory.name, phones: saved.contactPhones });
    saved.company = { companyName: await this.companyName(companyUserId) } as User;
    return saved;
  }

  private view(item: FactoryCargo) {
    return {
      id: item.id,
      companyUserId: item.companyUserId,
      companyName: item.company?.companyName || null,
      origin: item.origin,
      destination: item.destination,
      cargoType: item.cargoType ?? null,
      weight: item.weight ?? null,
      vehicleType: item.vehicleType ?? null,
      price: item.price ?? null,
      extraNotes: item.extraNotes ?? null,
      contactPhones: item.contactPhones,
      createdAt: item.createdAt,
    };
  }

  //#endregion

  /** A personal invite still in force: not revoked, and the company still has the «کارخانه‌ها» menu. */
  private async activeInvite(token: string): Promise<FactoryInvite | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const invite = await this.invites.findOne({ where: { token, revokedAt: IsNull() } });
    return invite?.factoryUserId && (await this.hasFactories(invite.companyUserId)) ? invite : null;
  }

  private async assertMember(factoryUserId: string, companyUserId: string): Promise<void> {
    if (!(await this.companies(factoryUserId)).some((company) => company.userId === companyUserId)) {
      throw new ForbiddenException('برای این شرکت لینک دعوت ندارید؛ یکی از شرکت‌های لیست خودتان را انتخاب کنید.');
    }
  }

  private async companyName(companyUserId: string): Promise<string> {
    const contact = await this.audience.findPublisherContact(companyUserId);
    return contact.company?.name || 'شرکت حمل‌ونقل';
  }

  /** نام کارخانه (پروفایل) و شماره‌هایش: تلفن پروفایل و موبایل ثبت‌نام. */
  private async factory(factoryUserId: string): Promise<{ name: string; phones: string[] }> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: factoryUserId } });
    if (!user) throw new BadRequestException('حساب کارخانه پیدا نشد.');
    const name = user.companyName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.mobile || 'کارخانه';
    const phones = [...new Set([user.phone, user.mobile].filter((phone): phone is string => !!phone?.trim()))];
    return { name, phones };
  }
}

function newToken(): string {
  return randomBytes(18).toString('base64url');
}

const displayName = (alias: string) =>
  `COALESCE(NULLIF(${alias}."companyName", ''), NULLIF(concat_ws(' ', ${alias}."firstName", ${alias}."lastName"), ''), ${alias}.mobile, ${alias}.username)`;
