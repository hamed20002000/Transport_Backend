const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(ONES[rest % 10]);
  }
  return parts.join(' و ');
}

/** عدد صحیح نامنفی به حروف: 1250 → «یک هزار و دویست و پنجاه» (برای خواندن با صدا). */
export function integerToPersianWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const groups: string[] = [];
  for (let scale = 0; n > 0 && scale < SCALES.length; scale++, n = Math.floor(n / 1000)) {
    const group = n % 1000;
    // «هزار» نه «یک هزار»
    if (group)
      groups.unshift(
        scale === 1 && group === 1 ? SCALES[1] : [belowThousand(group), SCALES[scale]].filter(Boolean).join(' '),
      );
  }
  return groups.join(' و ');
}

/** عدد با حداکثر یک رقم اعشار: 1.4 → «یک و چهار دهم»، 12 → «دوازده». */
export function decimalToPersianWords(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  const whole = Math.floor(rounded);
  const tenth = Math.round((rounded - whole) * 10);
  if (!tenth) return integerToPersianWords(whole);
  return whole ? `${integerToPersianWords(whole)} و ${ONES[tenth]} دهم` : `${ONES[tenth]} دهم`;
}

/** رقم‌های داخل متن (فارسی/عربی/لاتین) به حروف، مثل «جایگاه ۲۴» → «جایگاه بیست و چهار». */
export function spellNumbersInText(text: string): string {
  const latin = text
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  return latin.replace(/\d+/g, (digits) => integerToPersianWords(Number(digits)));
}
