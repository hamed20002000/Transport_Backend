import { BrokerPayModel, FareBasis, FareChangeReason, FareCurrency } from '../enums/tripFare';
import { parseCargoPrice } from '../../services/notification/cargoPrice';

/**
 * The pure rules of a trip's fare (TripFare), shared by the web API, the bots and WhatsApp: reading what the company
 * typed, the total, the broker's share, and the Persian wording. Nothing here touches the database.
 */

/** One stage's values as given (web body, or the bot form when it is done). */
export interface TripFareInput {
  basis: FareBasis;
  /** the amount: the whole fare (TOTAL) or the fare of one ton (PER_TON), in `currency` */
  rate: number;
  weightTons: number;
  currency?: FareCurrency;
  /** DELIVERED only: why it differs from the agreed fare (required then) */
  changeReason?: FareChangeReason | null;
  note?: string | null;
}

/** A stage's values once read: what is stored, with the total worked out. */
export interface TripFareValues {
  basis: FareBasis;
  rate: number;
  weightTons: number;
  currency: FareCurrency;
  total: number;
  changeReason: FareChangeReason | null;
  note: string | null;
}

// a ton count past this is a typo (or kilograms written as tons)
export const MAX_WEIGHT_TONS = 200;
const MAX_NOTE = 300;

export const FARE_BASIS_LABEL: Record<FareBasis, string> = {
  [FareBasis.Total]: 'دربست',
  [FareBasis.PerTon]: 'تنی',
};

export const FARE_CURRENCY_LABEL: Record<FareCurrency, string> = {
  [FareCurrency.Toman]: 'تومان',
  [FareCurrency.Dollar]: 'دلار',
  [FareCurrency.Euro]: 'یورو',
  [FareCurrency.Dirham]: 'درهم',
  [FareCurrency.Lira]: 'لیر',
};

export const FARE_CHANGE_REASON_LABEL: Record<FareChangeReason, string> = {
  [FareChangeReason.Shortage]: 'کسری بار',
  [FareChangeReason.Waiting]: 'توقف و انتظار',
  [FareChangeReason.Overweight]: 'اضافه‌بار',
  [FareChangeReason.ExtraCost]: 'هزینه‌ی جانبی',
  [FareChangeReason.Discount]: 'تخفیف',
  [FareChangeReason.Weight]: 'وزن بارنامه فرق داشت',
  [FareChangeReason.Other]: 'سایر',
};

export const BROKER_PAY_MODEL_LABEL: Record<BrokerPayModel, string> = {
  [BrokerPayModel.Commission]: 'کمیسیون از شرکت',
  [BrokerPayModel.Margin]: 'اختلاف کرایه',
};

const latin = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const persian = (value: number | string) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** «۴۵۰۰۰۰۰۰» → «۴۵٬۰۰۰٬۰۰۰»; decimals as «۲۵٫۵». */
export function faNumber(value: number): string {
  const [whole, fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return persian(fraction ? `${grouped}٫${fraction}` : grouped);
}

/**
 * An amount as typed: «45000000»، «۴۵٬۰۰۰٬۰۰۰»، «۴۵ میلیون»، «۸۵۰ هزار»، «1500 دلار»، «۴۵۰۰۰۰۰۰۰ ریال».
 * A bare number is taken as written (a per-ton fare may be well under a million); words and units as in the load's
 * price (parseCargoPrice). Null when there is no positive amount.
 */
export function readAmount(text: string | null | undefined): { amount: number; currency: FareCurrency } | null {
  if (!text) return null;
  const clean = latin(text).replace(/[\s,٬]/g, '');
  if (/^[0-9]+$/.test(clean)) {
    const amount = Number(clean);
    return amount > 0 && Number.isSafeInteger(amount) ? { amount, currency: FareCurrency.Toman } : null;
  }
  const price = parseCargoPrice(text);
  if (!price || !Number.isSafeInteger(price.amount) || price.amount <= 0) return null;
  return { amount: price.amount, currency: price.currency as FareCurrency };
}

/** The unit a weight is typed in: tons unless the company picks kilograms; stored in tons either way. */
export type WeightUnit = 'TON' | 'KG';

export const WEIGHT_UNIT_LABEL: Record<WeightUnit, string> = { TON: 'تن', KG: 'کیلوگرم' };

/**
 * A weight in tons as typed or as a load's weight is written: «۲۵»، «۲۵٫۵ تن»، «25 ton»، «۲۴۰۰۰ کیلو». A unit written
 * with the number wins; a bare number is in `unit`: kilograms, or tons (where one above MAX_WEIGHT_TONS is still
 * taken as kilograms). Null when there is none.
 */
export function readWeight(text: string | null | undefined, unit: WeightUnit = 'TON'): number | null {
  if (!text) return null;
  const clean = latin(text).replace(/٫/g, '.').replace(/[,٬](?=\d{3})/g, '');
  const match = clean.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  let tons = Number(match[0]);
  const kilos = /کیلو|kg/i.test(clean) || (!/تن|ton/i.test(clean) && (unit === 'KG' || tons > MAX_WEIGHT_TONS));
  if (kilos) tons /= 1000;
  tons = Math.round(tons * 100) / 100;
  return tons > 0 && tons <= MAX_WEIGHT_TONS ? tons : null;
}

/** readWeight in tons: a load's weight as written. */
export const readTons = (text: string | null | undefined): number | null => readWeight(text, 'TON');

/** The whole fare: the amount itself (TOTAL), or the per-ton fare times the weight (PER_TON), whole. */
export function fareTotal(basis: FareBasis, rate: number, weightTons: number): number {
  return basis === FareBasis.PerTon ? Math.round(rate * weightTons) : rate;
}

/** A stage's values checked: what is stored, or the reason they are refused (in Persian, for the user). */
export function readTripFare(input: Partial<TripFareInput> | null | undefined): { fare: TripFareValues } | { error: string } {
  if (!input) return { error: 'کرایه و وزن را وارد کنید.' };
  const basis = input.basis;
  if (!basis || !Object.values(FareBasis).includes(basis)) return { error: 'نوع کرایه را انتخاب کنید: دربست یا تنی.' };
  const rate = Number(input.rate);
  if (!Number.isSafeInteger(rate) || rate <= 0) return { error: 'مبلغ کرایه را با عدد وارد کنید.' };
  const weightTons = Math.round(Number(input.weightTons) * 100) / 100;
  if (!Number.isFinite(weightTons) || weightTons <= 0 || weightTons > MAX_WEIGHT_TONS) {
    return { error: `وزن بار را وارد کنید (بیشتر از صفر و تا ${persian(MAX_WEIGHT_TONS)} تن، یعنی ${faNumber(MAX_WEIGHT_TONS * 1000)} کیلوگرم).` };
  }
  const currency = input.currency ?? FareCurrency.Toman;
  if (!Object.values(FareCurrency).includes(currency)) return { error: 'واحد پول معتبر نیست.' };
  const changeReason = input.changeReason ?? null;
  if (changeReason && !Object.values(FareChangeReason).includes(changeReason)) return { error: 'دلیل تغییر معتبر نیست.' };
  const note = input.note?.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) || null;
  const total = fareTotal(basis, rate, weightTons);
  if (!Number.isSafeInteger(total)) return { error: 'مبلغ کرایه بیش از حد بزرگ است.' };
  return { fare: { basis, rate, weightTons, currency, total, changeReason, note } };
}

/** Whether the delivered values changed anything that matters for the money: the total, or the weight. */
export function fareChanged(agreed: Pick<TripFareValues, 'total' | 'currency' | 'weightTons'>, delivered: Pick<TripFareValues, 'total' | 'currency' | 'weightTons'>): boolean {
  return agreed.total !== delivered.total || agreed.currency !== delivered.currency || agreed.weightTons !== delivered.weightTons;
}

/** «۴۵٬۰۰۰٬۰۰۰ تومان» */
export function moneyText(amount: number, currency: FareCurrency = FareCurrency.Toman): string {
  return `${faNumber(amount)} ${FARE_CURRENCY_LABEL[currency]}`;
}

/**
 * The amount in words people check at a glance, so a missing or extra zero shows: «۴۵ میلیون و ۵۰۰ هزار تومان».
 * Other currencies as figures.
 */
export function moneyWords(amount: number, currency: FareCurrency = FareCurrency.Toman): string {
  if (currency !== FareCurrency.Toman) return moneyText(amount, currency);
  const parts: string[] = [];
  let rest = amount;
  for (const [size, word] of [[1e9, 'میلیارد'], [1e6, 'میلیون'], [1e3, 'هزار']] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${persian(count)} ${word}`);
    rest %= size;
  }
  if (rest) parts.push(persian(rest));
  return `${parts.join(' و ') || '۰'} تومان`;
}

/** One line for messages and lists: «دربست · ۴۵٬۰۰۰٬۰۰۰ تومان · ۲۵ تن» or «تنی ۱٬۸۰۰٬۰۰۰ تومان × ۲۵ تن = ۴۵٬۰۰۰٬۰۰۰ تومان». */
export function fareLine(fare: Pick<TripFareValues, 'basis' | 'rate' | 'weightTons' | 'currency' | 'total'>): string {
  const tons = `${faNumber(fare.weightTons)} تن`;
  return fare.basis === FareBasis.PerTon
    ? `تنی ${moneyText(fare.rate, fare.currency)} × ${tons} = ${moneyText(fare.total, fare.currency)}`
    : `دربست · ${moneyText(fare.total, fare.currency)} · ${tons}`;
}

/**
 * The starting values for the company's form, from the load as it was announced: its price (a per-ton price when it
 * says «تنی» / «هر تن») and its weight. Missing parts stay undefined for the company to fill.
 */
export function fareDefaultsFromListing(listing: { price?: string | null; weight?: string | null } | null | undefined): Partial<TripFareInput> {
  const price = readAmount(listing?.price);
  const perTon = !!listing?.price && /تنی|هر\s*تن|per\s*ton/i.test(listing.price);
  const weightTons = readTons(listing?.weight);
  return {
    basis: price ? (perTon ? FareBasis.PerTon : FareBasis.Total) : undefined,
    rate: price?.amount,
    currency: price?.currency ?? FareCurrency.Toman,
    weightTons: weightTons ?? undefined,
  };
}

/**
 * What a broker gets out of a delivered trip, from the fare the company confirmed (`companyTotal`):
 *   COMMISSION  the admin's percent of it, owed by the company (only for tomans, the unit the ledger adds up)
 *   MARGIN      the company's fare less the fare the broker gave the driver (the broker's own figure, for the record)
 * Null where it cannot be worked out.
 */
export function brokerEarning(
  model: BrokerPayModel,
  companyTotal: number,
  currency: FareCurrency,
  driverFare: number | null,
  percent: number,
): { commission: number | null; margin: number | null } {
  if (model === BrokerPayModel.Commission) {
    return { commission: currency === FareCurrency.Toman ? Math.round((companyTotal * percent) / 100) : null, margin: null };
  }
  return { commission: null, margin: currency === FareCurrency.Toman && driverFare !== null ? companyTotal - driverFare : null };
}
