import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { groupDigits } from './digitGroups';
import { isNationalCode } from './nationalId';

export { isNationalCode };

/**
 * The driver a broker requests a load for (BROKER_DRIVER_FIELDS): kept with the request only, no account is made for
 * it. The company sees it and may invite the driver by its mobile.
 */
export interface BrokerDriver {
  name: string;
  nationalCode: string;
  mobile: string;
  /** the Iranian plate, e.g. «۴۲ ع ۸۴۲ ایران ۳۵» */
  plate: string;
  /** the transit plate of international work, e.g. «81AA217/218»; null when it has none */
  transitPlate: string | null;
  // what the broker tells the company of this request (required of a broker; absent from older requests)
  /** the company the driver goes under */
  companyName?: string;
  /** the fare agreed, as written: digits only when it is a bare number («45000000»), else with its unit */
  fare?: string;
  /** the border crossing it leaves Iran by: older requests only; now CargoRequest.exitBorder, picked from a list */
  exitBorder?: string;
  /** who introduced the driver */
  referrer?: string;
}

export type BrokerDriverField = keyof BrokerDriver;

type FieldSpec = { key: BrokerDriverField; title: string; optional?: boolean };

/** Who the driver is: kept for the broker's next requests (its recent drivers). */
export const BROKER_DRIVER_IDENTITY_FIELDS: FieldSpec[] = [
  { key: 'name', title: 'نام و نام خانوادگی راننده' },
  { key: 'nationalCode', title: 'کد ملی راننده' },
  { key: 'mobile', title: 'موبایل راننده' },
  { key: 'plate', title: 'پلاک شهربانی' },
  { key: 'transitPlate', title: 'پلاک ترانزیت', optional: true },
];

/** This request's own details: asked again on every request, a recent driver too. */
export const BROKER_REQUEST_DETAIL_FIELDS: FieldSpec[] = [
  { key: 'companyName', title: 'نام شرکت' },
  { key: 'fare', title: 'مبلغ کرایه' },
  { key: 'referrer', title: 'معرف' },
];

/** In the order a broker gives them (the bots ask one by one); optional ones may be skipped. */
export const BROKER_DRIVER_FIELDS: FieldSpec[] = [...BROKER_DRIVER_IDENTITY_FIELDS, ...BROKER_REQUEST_DETAIL_FIELDS];

/** A recent driver without the details of the request it came from. */
export function brokerDriverIdentity(driver: BrokerDriver): BrokerDriver {
  const { name, nationalCode, mobile, plate, transitPlate } = driver;
  return { name, nationalCode, mobile, plate, transitPlate: transitPlate ?? null };
}

const latinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/** One field as given (any digits, spaces): its stored form, or the reason it is refused. */
export function readBrokerDriverField(key: BrokerDriverField, input: unknown): { value: string | null } | { error: string } {
  const text = typeof input === 'string' ? latinDigits(input).replace(/\s+/g, ' ').trim() : '';
  switch (key) {
    case 'name':
      if (text.length < 3 || text.length > 100) return { error: 'نام و نام خانوادگی راننده را کامل بنویسید.' };
      return { value: text };
    case 'nationalCode': {
      const code = text.replace(/[\s-]/g, '');
      return isNationalCode(code) ? { value: code } : { error: 'کد ملی راننده معتبر نیست؛ ۱۰ رقم است.' };
    }
    case 'mobile': {
      const mobile = normalizePhoneNumber(text.replace(/[\s-]/g, ''));
      return typeof mobile === 'string' && /^09[0-9]{9}$/.test(mobile) ? { value: mobile } : { error: 'موبایل راننده معتبر نیست؛ مثلاً 09121234567.' };
    }
    case 'plate':
      if (text.length < 5 || text.length > 30) return { error: 'پلاک شهربانی را کامل بنویسید؛ مثلاً ۴۲ ع ۸۴۲ ایران ۳۵.' };
      return { value: text };
    case 'transitPlate':
      if (!text || text === '-') return { value: null };
      return text.length <= 30 ? { value: text.toUpperCase() } : { error: 'پلاک ترانزیت بیش از حد بلند است.' };
    case 'companyName':
      if (text.length < 2 || text.length > 100) return { error: 'نام شرکت را کامل بنویسید.' };
      return { value: text };
    case 'fare': {
      if (!/[0-9]/.test(text) || text.length > 50) return { error: 'مبلغ کرایه را با عدد بنویسید؛ مثلاً ۴۵٬۰۰۰٬۰۰۰ تومان.' };
      // a bare number keeps only its digits; with a unit («1500 دلار») it stays as written
      return { value: /^[0-9][0-9\s,٬.]*$/.test(text) ? text.replace(/[^0-9]/g, '') : text };
    }
    case 'exitBorder':
      if (text.length < 2 || text.length > 60) return { error: 'مرز خروج را بنویسید؛ مثلاً بازرگان.' };
      return { value: text };
    case 'referrer':
      if (text.length < 2 || text.length > 100) return { error: 'معرف را بنویسید (نام یا شماره‌اش).' };
      return { value: text };
  }
}

/** All the fields at once (web): the driver, or the first reason one is refused. */
export function readBrokerDriver(input: Partial<Record<BrokerDriverField, unknown>> | null | undefined): { driver: BrokerDriver } | { error: string } {
  const driver: Partial<BrokerDriver> = {};
  for (const { key } of BROKER_DRIVER_FIELDS) {
    const result = readBrokerDriverField(key, input?.[key]);
    if ('error' in result) return result;
    (driver as Record<string, string | null>)[key] = result.value;
  }
  return { driver: driver as BrokerDriver };
}

/** The driver on one line, for the company's messages and lists. */
export function brokerDriverLine(driver: BrokerDriver): string {
  return [
    `🚚 ${driver.name}`,
    `کد ملی ${driver.nationalCode}`,
    `موبایل ${driver.mobile}`,
    `پلاک ${driver.plate}`,
    driver.transitPlate ? `ترانزیت ${driver.transitPlate}` : '',
    driver.companyName ? `شرکت ${driver.companyName}` : '',
    driver.fare ? `کرایه ${groupDigits(driver.fare)}` : '',
    driver.exitBorder ? `مرز خروج ${driver.exitBorder}` : '',
    driver.referrer ? `معرف ${driver.referrer}` : '',
  ].filter(Boolean).join(' · ');
}
