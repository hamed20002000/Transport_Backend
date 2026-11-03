import { normalizePhoneNumber } from 'src/dto/auth/phone-number';

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
}

export type BrokerDriverField = keyof BrokerDriver;

/** In the order a broker gives them (the bots ask one by one); optional ones may be skipped. */
export const BROKER_DRIVER_FIELDS: Array<{ key: BrokerDriverField; title: string; optional?: boolean }> = [
  { key: 'name', title: 'نام و نام خانوادگی راننده' },
  { key: 'nationalCode', title: 'کد ملی راننده' },
  { key: 'mobile', title: 'موبایل راننده' },
  { key: 'plate', title: 'پلاک شهربانی' },
  { key: 'transitPlate', title: 'پلاک ترانزیت', optional: true },
];

const latinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/** An Iranian personal national code (کد ملی) is real: 10 digits, the last one the check digit of the others. */
export function isNationalCode(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 9).reduce((total, digit, i) => total + digit * (10 - i), 0) % 11;
  return sum < 2 ? digits[9] === sum : digits[9] === 11 - sum;
}

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
  }
}

/** All the fields at once (web, the assistant): the driver, or the first reason one is refused. */
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
  ].filter(Boolean).join(' · ');
}
