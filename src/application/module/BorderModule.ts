import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BorderController } from '../../presentation/controllers/border/border.controller';
import { BorderDialog } from '../../services/border/borderDialog';
import { BorderStatusService } from '../../services/border/borderStatus.service';
import { BorderTools } from '../../services/border/borderTools';
import { MessengerBotModule } from './MessengerBotModule';
import { RedisModule } from './RedisModule';

/** وضعیت مرزهای زمینی از borderpark.ir: پنل وب، دکمه‌ی ربات‌ها/واتساپ و ابزار agent. */
@Module({
  imports: [ConfigModule, RedisModule, MessengerBotModule],
  controllers: [BorderController],
  providers: [BorderStatusService, BorderDialog, BorderTools],
  exports: [BorderStatusService],
})
export class BorderModule {}
