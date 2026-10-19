import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { BORDER_LOCATIONS } from 'src/services/border/borderLocations';
import { BorderDetail, BorderStatusService } from 'src/services/border/borderStatus.service';
import { IRAN_OUTLINE } from 'src/services/routing/iranBorder';

/** وضعیت مرزهای زمینی (borderpark.ir) برای پنل راننده و شرکت. */
@Controller('api/borders')
@UseGuards(JwtAuthGuard)
export class BorderController {
  constructor(private readonly borders: BorderStatusService) {}

  // همه‌ی مرزها با جمع صف، صف‌ها، اطلاعیه‌ها و تیرپارک‌ها
  @Get()
  async list() {
    return (await this.borders.details()).map((detail) => this.located(detail));
  }

  // مرز ساده‌شده‌ی ایران ([lng, lat]) تا نقشه‌ی مرزها بیرون ایران را کم‌رنگ کند؛ ثابت است
  @Get('outline')
  outline() {
    return { rings: IRAN_OUTLINE };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const detail = await this.borders.detail(id);
    if (!detail) throw new NotFoundException('Border not found.');
    return this.located(detail);
  }

  /** محل پایانه‌ی مرزی (برای نقشه)؛ null برای مرز تازه‌ای که هنوز در BORDER_LOCATIONS نیست. */
  private located(detail: BorderDetail) {
    return { ...detail, border: { ...detail.border, location: BORDER_LOCATIONS[detail.border.id] ?? null } };
  }
}
