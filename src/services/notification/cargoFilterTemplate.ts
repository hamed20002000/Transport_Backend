import { normalizePersianText } from '../../domain/helper/persianText';
import { parsePriceToman } from '../../domain/helper/price';
import { CargoAlertFilterInput } from './cargoAlertFilter.service';

/**
 * «فیلتر با قالب»: کاربر پیام‌رسان قالب را کپی می‌کند، جلوی هر خط مقدار می‌نویسد و یک‌جا
 * می‌فرستد؛ به‌جای مرحله‌به‌مرحله. خط‌هایی که عنوانشان شناخته نشود (توضیح، سلام) نادیده
 * گرفته می‌شوند، پس کپی کل پیام هم کار می‌کند. خالی، «همه» یا «-» یعنی همه / بدون حد.
 */

type TemplateField = keyof Pick<
  CargoAlertFilterInput,
  'label' | 'origins' | 'destinations' | 'cargoTypes' | 'vehicleTypes' | 'companies' | 'minPrice' | 'maxPrice'
>;

const FIELDS: { field: TemplateField; title: string; aliases: string[]; driverOnly?: boolean }[] = [
  { field: 'label', title: 'عنوان', aliases: ['عنوان', 'عنوان فیلتر', 'نام', 'نام فیلتر'] },
  { field: 'origins', title: 'مبدأ', aliases: ['مبدأ', 'مبدا', 'مبداها', 'از'] },
  { field: 'destinations', title: 'مقصد', aliases: ['مقصد', 'مقصدها', 'به'] },
  { field: 'cargoTypes', title: 'نوع بار', aliases: ['نوع بار', 'بار', 'کالا', 'جنس'] },
  { field: 'vehicleTypes', title: 'نوع خودرو', aliases: ['نوع خودرو', 'خودرو', 'ماشین', 'بارگیر'] },
  { field: 'companies', title: 'شرکت حمل‌ونقل', aliases: ['شرکت حمل‌ونقل', 'شرکت حمل و نقل', 'شرکت‌های حمل‌ونقل', 'شرکت', 'شرکت‌ها', 'شرکتها'], driverOnly: true },
  { field: 'minPrice', title: 'حداقل کرایه', aliases: ['حداقل کرایه', 'حداقل', 'کرایه از'] },
  { field: 'maxPrice', title: 'حداکثر کرایه', aliases: ['حداکثر کرایه', 'حداکثر', 'کرایه تا'] },
];

const LIMITS = { label: 150, items: 50, item: 100 };
const EMPTY = /^(?:همه|هر|هرچی|فرقی نمی ?کند|بدون حد|ندارد|-+|—)$/;

const key = (text: string) => normalizePersianText(text).replace(/[\s‌]/g, '').replace(/أ/g, 'ا');
const ALIASES = new Map(FIELDS.flatMap((item) => item.aliases.map((alias) => [key(alias), item] as const)));

/** متن قالب برای کپی؛ «شرکت» فقط برای راننده. */
export function filterTemplateText(driver: boolean): string {
  return FIELDS.filter((item) => driver || !item.driverOnly)
    .map((item) => `${item.title}: `)
    .join('\n');
}

export type FilterTemplateResult =
  | { kind: 'none' }
  | { kind: 'invalid'; problems: string[] }
  | { kind: 'ok'; input: CargoAlertFilterInput };

/**
 * متن فرستاده‌شده به‌عنوان قالب. none اگر هیچ خطی از قالب نبود (متن چیز دیگری است).
 * minLines: کمترین تعداد خط قالب تا متن قالب حساب شود (وسط فرم مرحله‌ای، متن یک‌خطی جواب همان مرحله است).
 */
export function parseFilterTemplate(text: string, driver: boolean, minLines = 1): FilterTemplateResult {
  const input: CargoAlertFilterInput = {};
  const problems: string[] = [];
  let lines = 0;

  for (const raw of text.split(/\r?\n/)) {
    // «۱- مبدأ: تهران»، «• مبدا : تهران»
    const match = raw.match(/^\s*(?:[-•*]|[\d۰-۹]+\s*[-.)])?\s*([^:：]{1,20}?)\s*[:：]\s*(.*)$/);
    const item = match ? ALIASES.get(key(match[1])) : undefined;
    if (!match || !item || (item.driverOnly && !driver)) continue;
    lines++;
    const value = match[2].trim();
    if (!value || EMPTY.test(normalizePersianText(value))) continue;

    if (item.field === 'label') {
      if (value.length > LIMITS.label) problems.push(`«${item.title}» بیشتر از ${LIMITS.label} حرف است.`);
      else input.label = value;
    } else if (item.field === 'minPrice' || item.field === 'maxPrice') {
      const amount = parsePriceToman(value);
      if (amount === null) problems.push(`«${item.title}» فهمیده نشد («${value}»)؛ مثلاً بنویسید ۲۰ میلیون.`);
      else input[item.field] = amount;
    } else {
      const values = [...new Set(value.split(/[,،;؛]+/).map((part) => part.trim()).filter((part) => part && !EMPTY.test(part)))];
      if (values.some((part) => part.length > LIMITS.item)) problems.push(`یکی از مقدارهای «${item.title}» خیلی طولانی است.`);
      else if (values.length > LIMITS.items) problems.push(`«${item.title}» حداکثر ${LIMITS.items} مقدار می‌گیرد.`);
      else if (values.length) input[item.field] = values;
    }
  }

  if (lines < minLines || lines === 0) return { kind: 'none' };
  if (input.minPrice != null && input.maxPrice != null && input.minPrice > input.maxPrice) {
    problems.push('حداقل کرایه نباید از حداکثر بیشتر باشد.');
  }
  const conditions = Object.entries(input).some(([field, value]) => field !== 'label' && value != null);
  if (!problems.length && !conditions) problems.push('دست‌کم یک شرط (مثلاً مبدأ یا مقصد) بنویسید؛ فیلتر بدون شرط همه‌ی بارها را نشان می‌دهد.');
  return problems.length ? { kind: 'invalid', problems } : { kind: 'ok', input };
}
