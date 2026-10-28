import { Controller, Get, Inject, NotFoundException, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { IBotLinkRepository } from 'src/domain/repositories/messengerBot/IBotLinkRepository';
import { BOT_LINK_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { MessengerLinkCodeService } from 'src/services/messengerBot/core/messengerLinkCode.service';
import { EitaaBotService } from 'src/services/messengerBot/eitaa/eitaaBot.service';

type AuthRequest = { user?: JwtPayload };

function currentUserId(request: AuthRequest): string {
  const userId = request.user?.userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
}

/** «اتصال ایتا» در پروفایل: کد یک‌بارمصرفی که کاربر برای حساب ایتای سامانه می‌فرستد (MessengerLinkCodeService). */
@Controller('api/messenger/eitaa')
@UseGuards(JwtAuthGuard)
export class EitaaLinkController {
  constructor(
    private readonly eitaa: EitaaBotService,
    private readonly codes: MessengerLinkCodeService,
    @Inject(BOT_LINK_REPOSITORY) private readonly links: IBotLinkRepository,
  ) {}

  // enabled false: ایتا روی این سرور راه نیفتاده و پنل کارتش را نشان نمی‌دهد
  @Get()
  async status(@Req() request: AuthRequest) {
    const account = this.eitaa.account;
    if (!account) return { enabled: false, account: null, linked: false };
    const link = await this.links.findByUserId(currentUserId(request), 'eitaa');
    return { enabled: true, account, linked: !!link };
  }

  @Post('link-code')
  async linkCode(@Req() request: AuthRequest) {
    if (!this.eitaa.account) throw new NotFoundException('ایتا فعال نیست.');
    return { ...(await this.codes.create('eitaa', currentUserId(request))), account: this.eitaa.account };
  }
}
