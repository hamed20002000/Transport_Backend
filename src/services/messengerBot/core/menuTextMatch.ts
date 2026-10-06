/** دکمه‌ی منوی فعلی کاربر: متنی که می‌بیند و callback_dataای که زدنش می‌فرستد. */
export interface MenuButton {
  text: string;
  data: string;
}

/**
 * متن را برای مقایسه یکدست می‌کند: ایموجی و علائم حذف، ي/ك عربی → ی/ک،
 * اعداد فارسی/عربی → لاتین، نیم‌فاصله و فاصله‌های پشت هم → یک فاصله.
 */
export function normalizeMenuText(text: string): string {
  return text
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[ً-ٰٟ]/g, '') // اعراب
    .replace(/‌/g, ' ') // نیم‌فاصله
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // ایموجی و علائم
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * دکمه‌ای از منوی فعلی که کاربر با تایپ/ویس منظورش بوده، یا null (آن وقت پیام
 * به agent و ابزارهایش می‌رود). فقط چیزهایی که agent نمی‌فهمد چون منو را نمی‌بیند:
 *   ۱. شماره‌ی گزینه («۲»، «گزینه ۲»، «دومی رو بزن»)
 *   ۲. متن دقیقاً متن دکمه («اشتراک من»)؛ میان‌بر بدون انتظار برای LLM
 */
export function findMenuButton(input: string, buttons: MenuButton[]): MenuButton | null {
  const text = normalizeMenuText(input);
  if (!text) return null;

  const position = optionPosition(text, buttons.length);
  if (position !== null) return buttons[position] ?? null;

  const exact = buttons.filter((button) => normalizeMenuText(button.text) === text);
  return exact.length === 1 ? exact[0] : null;
}

//#region ----------- Option number («گزینه ۲»، «دومی») -----------------------

const ORDINALS = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم'];
// «نه» و «یک» تنها معنی دیگری هم دارند؛ عدد با حروف فقط بعد از «گزینه/شماره» قبول است.
const CARDINALS = ['یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده'];
const OPTION_WORDS = new Set(['گزینه', 'شماره', 'دکمه', 'مورد']);
// کلمه‌های اطراف که معنی را عوض نمی‌کنند: «لطفا گزینه ۲ رو بزن»
const FILLER_WORDS = new Set(['لطفا', 'ی', 'رو', 'را', 'بزن', 'انتخاب', 'کن', 'میکنم', 'میخوام', 'می', 'خوام', 'خواهم']);

/** اندیس گزینه (از ۰، به ترتیب نمایش دکمه‌ها) اگر کل پیام فقط اشاره به شماره‌ی گزینه باشد، وگرنه null. */
export function optionPosition(text: string, count: number): number | null {
  const words = text.split(' ').filter((word) => !FILLER_WORDS.has(word));
  const hasOptionWord = OPTION_WORDS.has(words[0]);
  if (hasOptionWord) words.shift();
  if (words.length !== 1) return null;

  const word = words[0];
  let number: number | undefined;
  if (/^\d{1,2}$/.test(word)) number = Number(word);
  else if (word === 'اخر' || word === 'اخری') number = count; // «آخری» بعد از normalizeMenuText
  else {
    const ordinal = ORDINALS.findIndex((item) => word === item || word === `${item}ی`);
    if (ordinal >= 0) number = ordinal + 1;
    else if (word === 'یکم' || word === 'یکمی') number = 1;
    else if (hasOptionWord && CARDINALS.includes(word)) number = CARDINALS.indexOf(word) + 1;
  }
  return number !== undefined && number >= 1 ? number - 1 : null;
}

//#endregion

