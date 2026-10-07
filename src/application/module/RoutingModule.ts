import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FuelStation } from '../../domain/entities/routing/FuelStation';
import { FuelStationService } from '../../services/routing/fuelStation.service';
import { RoutingService } from '../../services/routing/routing.service';
import { StaticMapService } from '../../services/routing/staticMap.service';
import { RedisModule } from './RedisModule';

/** مکان‌یابی، مسیرهای جایگزین و جایگاه‌های سوخت (OpenStreetMap یا نشان). */
@Module({
  imports: [TypeOrmModule.forFeature([FuelStation]), ConfigModule, RedisModule],
  providers: [RoutingService, FuelStationService, StaticMapService],
  exports: [RoutingService, FuelStationService, StaticMapService],
})
export class RoutingModule {}
