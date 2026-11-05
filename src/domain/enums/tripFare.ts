/**
 * The fare of a trip (CargoRequest), recorded by the company at two moments (TripFare.stage):
 *   AGREED     when it closes the deal: accepts a request, or hands the load to a driver
 *   DELIVERED  when it confirms the delivery: the agreed values shown again, changed only if they changed
 * Each stage is its own row: the agreed one is never overwritten, so both stay for the figures.
 */
export enum TripFareStage {
  Agreed = 'AGREED',
  Delivered = 'DELIVERED',
}

/** How the fare is quoted: one amount for the whole truck («دربست»), or an amount per ton («تنی»). */
export enum FareBasis {
  Total = 'TOTAL',
  PerTon = 'PER_TON',
}

/** The currency of a fare: tomans (how freight is quoted in Iran) unless written otherwise (CargoPriceCurrency). */
export enum FareCurrency {
  Toman = 'IRT',
  Dollar = 'USD',
  Euro = 'EUR',
  Dirham = 'AED',
  Lira = 'TRY',
}

/** Why the delivered fare differs from the agreed one; asked only when it does. */
export enum FareChangeReason {
  // کسری بار
  Shortage = 'SHORTAGE',
  // توقف و انتظار
  Waiting = 'WAITING',
  // اضافه‌بار
  Overweight = 'OVERWEIGHT',
  // هزینه‌ی جانبی (تخلیه، بارگیری، عوارض)
  ExtraCost = 'EXTRA_COST',
  Discount = 'DISCOUNT',
  // وزن بارنامه با وزن توافقی فرق داشت (کرایه‌ی تنی)
  Weight = 'WEIGHT',
  Other = 'OTHER',
}

/**
 * How a broker (واسط) is paid for a load it brought, chosen by the company when it accepts the broker's request:
 *   COMMISSION  the broker passes the company's fare on to the driver; the company owes it a percent of that fare
 *               (the admin's BrokerAccessPolicy.commissionPercent), kept in CargoRequest.brokerCommission
 *   MARGIN      the broker keeps the gap between the company's fare and the fare it gives the driver; the company owes
 *               it nothing more (CargoRequest.brokerMargin, for the figures)
 */
export enum BrokerPayModel {
  Commission = 'COMMISSION',
  Margin = 'MARGIN',
}
