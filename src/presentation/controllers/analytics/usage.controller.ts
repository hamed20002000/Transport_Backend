import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { isUsageChannel, webChannel } from 'src/domain/entities/analytics/usageChannel';
import { UsageService } from 'src/services/analytics/usage.service';

type AuthRequest = { user?: { userId?: string } };

export class AppOpenedDto {
  /** pwa: the installed app; web: the site in a browser */
  @IsIn(['pwa', 'web'])
  mode!: 'pwa' | 'web';

  /** where the link that opened it was (?src= of a messenger message, push for a phone notification) */
  @IsOptional() @IsString() @MaxLength(20)
  source?: string;
}

/** The web panel says it was opened, once a day and again when a link opened it (the admin's usage figures). */
@Controller('api/usage')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /**
   * Whether the user has the app installed (opened it installed at least once). Safari on iPhone cannot tell from the
   * page: the installed app keeps its own storage. The install prompt stops asking once this is true.
   */
  @Get('installed')
  async installed(@Req() request: AuthRequest): Promise<{ installed: boolean }> {
    const userId = request.user?.userId;
    if (!userId) throw new UnauthorizedException();
    return { installed: await this.usage.openedInstalledApp(userId) };
  }

  @Post('opened')
  @HttpCode(204)
  async opened(@Req() request: AuthRequest, @Body() dto: AppOpenedDto): Promise<void> {
    const userId = request.user?.userId;
    if (!userId) throw new UnauthorizedException();
    await this.usage.active(userId, webChannel(dto.mode));
    if (dto.source === 'push') await this.usage.event(userId, 'push_click', 'push');
    else if (isUsageChannel(dto.source)) await this.usage.event(userId, 'link_open', dto.source);
  }
}
