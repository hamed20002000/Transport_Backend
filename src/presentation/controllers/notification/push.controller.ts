import { BadRequestException, Body, Controller, Delete, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
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
}

/** اعلان سیستمی گوشی (Web Push): کلید عمومی برای مرورگر، و ثبت/حذف اشتراک هر دستگاه. */
@Controller('api/push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: WebPushService) {}

  // null: اعلان روی این سرور تنظیم نشده و پنل دکمه‌اش را نشان نمی‌دهد
  @Get('public-key')
  publicKey() {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscriptions')
  async subscribe(@Req() request: AuthRequest, @Body() body: SubscriptionBody) {
    const { endpoint, keys } = body ?? {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) throw new BadRequestException('endpoint');
    if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) {
      throw new BadRequestException('keys');
    }
    await this.push.subscribe(currentUserId(request), { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    return { subscribed: true };
  }

  @Delete('subscriptions')
  async unsubscribe(@Req() request: AuthRequest, @Body() body: { endpoint?: unknown }) {
    if (typeof body?.endpoint !== 'string') throw new BadRequestException('endpoint');
    await this.push.unsubscribe(currentUserId(request), body.endpoint);
    return { subscribed: false };
  }
}
