/** دکمه‌ی منوی فعلی کاربر: متنی که می‌بیند و callback_dataای که زدنش می‌فرستد. */
export interface MenuButton {
  text: string;
  /** callback_data; empty for a link button */
  data: string;
  /** a link button (a map route, a site): chosen by text or voice, its link is sent since a bot cannot open it */
  url?: string;
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
 *   ۳. اسم دکمه با کلمه‌های فرمان («قیمت طلا رو نشون بده» ← «قیمت دلار و طلا»)
 */
export function findMenuButton(input: string, buttons: MenuButton[]): MenuButton | null {
  const text = normalizeMenuText(input);
  if (!text) return null;

  const position = optionPosition(text, buttons.length);
  if (position !== null) return buttons[position] ?? null;

  const exact = buttons.filter((button) => normalizeMenuText(button.text) === text);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  return phraseMatch(text, buttons);
}

//#region ----------- Button named in a short request («قیمت طلا رو نشون بده») -------

// words that only say «show / open it»; what is left names the button
const COMMAND_WORDS = new Set([
  'نشون', 'نشان', 'بده', 'بدید', 'بدین', 'بیار', 'بیارید', 'باز', 'کن', 'کنید', 'برو', 'بریم', 'بزن', 'بزنید',
  'منو', 'منوی', 'بخش', 'صفحه', 'قسمت', 'رو', 'را', 'لطفا', 'لطفاً', 'میخوام', 'میخواهم', 'می', 'خوام', 'خواهم',
  'ببینم', 'ببینیم', 'ببین', 'به', 'من', 'و',
]);
// a short request names a button; anything longer (a load to register, a question) is for the agent
const MAX_NAME_WORDS = 4;


/**
 * The one button whose text contains every word the user said (after the command words): «قیمت طلا» names
 * «قیمت دلار و طلا», «بار یک» names «بار ۱: مسیر و جزئیات». Nothing when a number is three digits or more (a
 * load code or an amount: the agent's), when the request is long, or when more than one button fits.
 */
/** The words that name a button (spoken numbers as digits, command words dropped); null when it is no name. */
function namedWords(text: string): { said: string[]; named: string[] } | null {
  const said = text
    .split(' ')
    .filter(Boolean)
    .map((word) => SPOKEN_INDEX[word] ?? word);
  if (said.some((word) => /\d{3,}/.test(word))) return null;
  const named = said.filter((word) => !COMMAND_WORDS.has(word));
  if (!named.length || named.length > MAX_NAME_WORDS) return null;
  return { said, named };
}

/** Buttons whose text holds every named word. */
function buttonsNamed(named: string[], buttons: MenuButton[]): MenuButton[] {
  return buttons.filter((button) => {
    const words = new Set(normalizeMenuText(button.text).split(' '));
    return named.every((word) => words.has(word));
  });
}

function phraseMatch(text: string, buttons: MenuButton[]): MenuButton | null {
  const words = namedWords(text);
  if (!words) return null;
  const { said, named } = words;
  // «جایگاه دو»: the row of a numbered list whose text starts with that number («۲. …»)
  const numbers = named.filter((word) => /^\d{1,2}$/.test(word));
  if (numbers.length === 1) {
    const row = buttons.filter((button) => normalizeMenuText(button.text).split(' ')[0] === numbers[0]);
    if (row.length === 1) return row[0];
  }
  const fits = buttonsNamed(named, buttons);
  if (fits.length === 1) return fits[0];
  // «اشتراک من رو ببینم»: of the buttons that fit, the one that also has the user's «من»
  const withMine = said.includes('من') ? fits.filter((button) => normalizeMenuText(button.text).split(' ').includes('من')) : [];
  return withMine.length === 1 ? withMine[0] : null;
}

/**
 * A short request that names more than one button («جایگاه سوخت» when several stations are called that): it
 * is about this menu, not a command for the agent, so the user is asked for the number instead.
 */
export function namesSeveralButtons(input: string, buttons: MenuButton[]): boolean {
  const text = normalizeMenuText(input);
  const words = text ? namedWords(text) : null;
  return !!words && !findMenuButton(input, buttons) && buttonsNamed(words.named, buttons).length > 1;
}

//#endregion

//#region ----------- Option number («گزینه ۲»، «دومی») -----------------------

const ORDINALS = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم'];
// «نه» و «یک» تنها معنی دیگری هم دارند؛ عدد با حروف فقط بعد از «گزینه/شماره» قبول است.
const CARDINALS = ['یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده'];
const OPTION_WORDS = new Set(['گزینه', 'شماره', 'دکمه', 'مورد']);
// کلمه‌های اطراف که معنی را عوض نمی‌کنند: «لطفا گزینه ۲ رو بزن»
const FILLER_WORDS = new Set(['لطفا', 'ی', 'رو', 'را', 'بزن', 'انتخاب', 'کن', 'میکنم', 'میخوام', 'می', 'خوام', 'خواهم']);
// a row number said in words («بار یک»، «بار دوم»), as the button has it («بار ۱: …»); «نه» alone is «no», not 9
const SPOKEN_INDEX: Record<string, string> = Object.fromEntries([
  ...CARDINALS.flatMap((word, i) => (word === 'نه' ? [] : [[word, String(i + 1)]])),
  ['یه', '1'],
  ...ORDINALS.flatMap((word, i) => [[word, String(i + 1)], [`${word}ی`, String(i + 1)]]),
  ['یکم', '1'],
  ['یکمی', '1'],
]);

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
