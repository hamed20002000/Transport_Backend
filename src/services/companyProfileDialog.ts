import { forwardRef, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgentGateway } from '../application/services/agent/agent.gateway';
import { BotCallback } from '../domain/constants/bot/BotCallback';
import { CustomerType } from '../domain/enums/company.enum';
import { IUserRepository } from '../domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from '../domain/repositories/repository.tokens';
import { UpdateUserProfileDto } from '../dto/user/update-user-profile.dto';
import { BotContext, BotDialog, BotDialogRegistry, BotReply } from './messengerBot/core/botDialog';
import { RedisService } from './redis/redis.service';
import { UserService } from './UserService';

const SHOW = 'cp:show';
const CLOSE = 'cp:close';
const EDIT = 'cp:edit:';
const fields = {
  companyName: 'نام شرکت', domesticCompanyName: 'نام شرکت داخلی', internationalCompanyName: 'نام شرکت بین‌المللی',
  companyNationalId: 'شناسه ملی شرکت',
  economicCode: 'کد اقتصادی', registrationNo: 'شماره ثبت',
  phone: 'تلفن ثابت', postalCode: 'کد پستی', address: 'نشانی',
};
type Field = keyof typeof fields;

@Injectable()
export class CompanyProfileDialog implements BotDialog, OnModuleInit {
  readonly entries = { [BotCallback.CompanyProfile]: SHOW };
  constructor(
    private readonly users: UserService,
    @Inject(USER_REPOSITORY) private readonly repository: IUserRepository,
    private readonly redis: RedisService,
    private readonly registry: BotDialogRegistry,
    @Inject(forwardRef(() => AgentGateway)) private readonly gateway: AgentGateway,
  ) {}

  onModuleInit() { this.registry.register(this); }
  ownsAction(id: string) { return id.startsWith('cp:'); }
  private key(ctx: Pick<BotContext, 'platform' | 'externalUserId'>) {
    return RedisService.key('companyProfileDialog', ctx.platform, ctx.externalUserId);
  }
  async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.key(ctx));
  }
  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>) {
    return (await this.redis.getJson(this.key(ctx))) !== null;
  }
  private async allowed(ctx: BotContext) {
    const user = await this.repository.findById(ctx.userId);
    return !!user?.userRoles?.some((item) => ['COMPANY', 'COMPANY_ADMIN'].includes(item.role?.name ?? ''));
  }
  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    if (!(await this.allowed(ctx))) return { text: 'این بخش فقط برای حساب شرکت است.', actions: [], closed: 'denied' };
    await this.redis.delete(this.key(ctx));
    if (id === CLOSE) return { text: '', actions: [], closed: 'exit' };
    const field = id.slice(EDIT.length) as Field;
    if (id.startsWith(EDIT) && Object.hasOwn(fields, field)) {
      await this.redis.setJson(this.key(ctx), { field }, 15 * 60);
      return { text: `${fields[field]} جدید را بفرستید. برای پاک کردن مقدار، «پاک» را بفرستید.`, actions: [{ id: SHOW, label: 'انصراف' }] };
    }
    return this.view(ctx);
  }
  async handleText(ctx: BotContext, text: string): Promise<BotReply | null> {
    const session = await this.redis.getJson<{ field: Field }>(this.key(ctx));
    if (!session) return null;
    if (!(await this.allowed(ctx))) {
      await this.redis.delete(this.key(ctx));
      return { text: 'این بخش فقط برای حساب شرکت است.', actions: [], closed: 'denied' };
    }
    if (['لغو', 'انصراف', 'cancel'].includes(text.trim())) return this.handleAction(ctx, SHOW);
    const value = text.trim() === 'پاک' ? null : text.trim().replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    const dto = plainToInstance(UpdateUserProfileDto, { [session.field]: value });
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) {
      return { text: `${fields[session.field]} معتبر نیست. مقدار درست را دوباره بفرستید.`, actions: [{ id: SHOW, label: 'انصراف' }] };
    }
    // شرکت همیشه حقوقی است؛ پروفایل قدیمیِ «حقیقی» با اولین ذخیره درست می‌شود
    await this.users.updateProfile(ctx.userId, Object.assign(dto, { profileType: CustomerType.Company }));
    await this.redis.delete(this.key(ctx));
    await this.gateway.broadcastDomainChange(ctx.userId, 'company_profile', {});
    return this.view(ctx, 'اطلاعات پروفایل ذخیره شد.');
  }
  private async view(ctx: BotContext, notice?: string): Promise<BotReply> {
    const profile = await this.users.getProfile(ctx.userId);
    return {
      text: [notice, '🏢 پروفایل شرکت',
        ...Object.entries(fields).map(([key, label]) => `${label}: ${profile[key as Field] || 'ثبت نشده'}`),
        `موبایل: ${profile.mobile || 'ثبت نشده'}`, `ایمیل: ${profile.email || 'ثبت نشده'}`,
      ].filter(Boolean).join('\n'),
      actions: [...Object.entries(fields).map(([key, label], index) => ({ id: `${EDIT}${key}`, label: `ویرایش ${label}`, row: Math.floor(index / 2) + 1 })),
        { id: CLOSE, label: '↩️ بازگشت', row: 10 }],
    };
  }
}
