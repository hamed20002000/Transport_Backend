import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { BorderStatusService } from 'src/services/border/borderStatus.service';

/** وضعیت مرزهای زمینی (borderpark.ir) برای پنل راننده و شرکت. */
@Controller('api/borders')
@UseGuards(JwtAuthGuard)
export class BorderController {
  constructor(private readonly borders: BorderStatusService) {}

  // همه‌ی مرزها با جمع صف، صف‌ها، اطلاعیه‌ها و تیرپارک‌ها
  @Get()
  list() {
    return this.borders.details();
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const detail = await this.borders.detail(id);
    if (!detail) throw new NotFoundException('Border not found.');
    return detail;
  }
}
