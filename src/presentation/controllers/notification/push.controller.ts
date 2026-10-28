import { BadRequestException, Body, Controller, Delete, Get, Inject, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { WebPushService } from 'src/services/notification/webPush.service';

type AuthRequest = { user?: JwtPayload };

function currentUserId(request: AuthRequest): string {
  const userId = request.user?.userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
}

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  // the holder confirmed the phone is theirs: move it from the account that has it
  takeOver?: unknown;
}

// enough of another account's number to recognise it, without handing the whole number to whoever holds the phone
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length > 8 ? `${phone.slice(0, 4)}•••${phone.slice(-4)}` : '•••';
}

/** اعلان سیستمی گوشی (Web Push): کلید عمومی برای مرورگر، و ثبت/حذف اشتراک هر دستگاه. */
@Controller('api/push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(
    private readonly push: WebPushService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  // null: اعلان روی این سرور تنظیم نشده و پنل دکمه‌اش را نشان نمی‌دهد.
  // phone: شماره‌ی حساب، تا پیش از روشن کردن اعلان بپرسد «اعلان‌های این شماره روی این گوشی بیاید؟» و
  // کسی که روی گوشی خودش برای دیگری حساب ساخته، اعلان او را به گوشی خودش نکشد.
  @Get('public-key')
  async publicKey(@Req() request: AuthRequest) {
    const user = await this.users.findById(currentUserId(request));
    return { publicKey: this.push.publicKey, phone: user?.mobile ?? null };
  }

  @Post('subscriptions')
  async subscribe(@Req() request: AuthRequest, @Body() body: SubscriptionBody) {
    const { endpoint, keys } = body ?? {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) throw new BadRequestException('endpoint');
    if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) {
      throw new BadRequestException('keys');
    }
    // false: this device's notifications already belong to another account and takeOver was not asked
    const subscribed = await this.push.subscribe(
      currentUserId(request),
      { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      body.takeOver === true,
    );
    return { subscribed };
  }

  // the device card in the profile: whether this device's notifications go to this account, and if to another one,
  // its masked number for «move them to this account?»
  @Post('subscriptions/status')
  async status(@Req() request: AuthRequest, @Body() body: { endpoint?: unknown }) {
    if (typeof body?.endpoint !== 'string') throw new BadRequestException('endpoint');
    const ownerId = await this.push.ownerOf(body.endpoint);
    if (!ownerId) return { owner: 'none', otherPhone: null };
    if (ownerId === currentUserId(request)) return { owner: 'mine', otherPhone: null };
    const other = await this.users.findById(ownerId);
    return { owner: 'other', otherPhone: maskPhone(other?.mobile) };
  }

  @Delete('subscriptions')
  async unsubscribe(@Req() request: AuthRequest, @Body() body: { endpoint?: unknown }) {
    if (typeof body?.endpoint !== 'string') throw new BadRequestException('endpoint');
    await this.push.unsubscribe(currentUserId(request), body.endpoint);
    return { subscribed: false };
  }
}
