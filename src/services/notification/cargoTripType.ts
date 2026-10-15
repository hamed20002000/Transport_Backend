import { Injectable } from '@nestjs/common';

import { CargoTripType } from '../../domain/enums/notification';
import { isInIran } from '../routing/iranBorder';
import { RoutingService } from '../routing/routing.service';

export const TRIP_TYPE_LABELS: Record<CargoTripType, string> = {
  [CargoTripType.Domestic]: 'داخلی',
  [CargoTripType.Export]: 'صادراتی',
  [CargoTripType.Import]: 'وارداتی',
};

/** «صادراتی» → EXPORT؛ متن آزاد (اکسل، agent) هم: «صادرات»، «export»، «داخل». */
export function parseTripType(value: unknown): CargoTripType | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (Object.values(CargoTripType).includes(text.toUpperCase() as CargoTripType)) return text.toUpperCase() as CargoTripType;
  if (/صادر|export/.test(text)) return CargoTripType.Export;
  if (/وارد|import/.test(text)) return CargoTripType.Import;
  if (/داخل|domestic/.test(text)) return CargoTripType.Domestic;
  return null;
}

/**
 * نوع بار از مبدأ و مقصد: ایران → خارج صادراتی، خارج → ایران وارداتی، هر دو ایران داخلی.
 * مکانی که پیدا نشد داخل ایران فرض می‌شود (بیشتر بارها داخلی‌اند)؛ هر دو طرف خارج
 * (ترانزیت) بین‌المللی است و صادراتی حساب می‌شود.
 */
@Injectable()
export class CargoTripTypeService {
  constructor(private readonly routing: RoutingService) {}

  async classify(origin: string, destination: string): Promise<CargoTripType> {
    const [from, to] = await Promise.all([this.inIran(origin), this.inIran(destination)]);
    if (from && to) return CargoTripType.Domestic;
    if (from) return CargoTripType.Export;
    if (to) return CargoTripType.Import;
    return CargoTripType.Export;
  }

  private async inIran(place: string): Promise<boolean> {
    const point = await this.routing.geocode(place).catch(() => null);
    return !point || isInIran(point);
  }
}
