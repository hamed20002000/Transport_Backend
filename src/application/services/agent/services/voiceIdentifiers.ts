/** شناسه‌ها را از گفتار حدس نمی‌زنیم؛ کاربر باید متن و صفرها را بررسی کند. */

// «کد» of a load. «کد ملی/پستی/اقتصادی/رهگیری…» are the user's own numbers (profile, payment), not a load code.
const LOAD_CODE_WORD = /کد(?!\s*(?:ملی|پستی|اقتصادی|شناسه|رهگیری|ثبت|تخفیف))/u;

const VEHICLE = '(?:ماشین|خودرو|کامیون|تریلی|کشنده|اتوبوس|وانت)';
// an Iranian plate: two digits, a letter, three digits («۱۲ ب ۳۴۵»), or «ایران ۶۷»
const PLATE_SHAPE = /[0-9۰-۹٠-٩]{2}\s*[آ-ی]\s*[0-9۰-۹٠-٩]{3}|ایران\s*[0-9۰-۹٠-٩]{2}/u;
// words of an address: there «پلاک ۱۵۲» is a house number
const ADDRESS = /نشانی|آدرس|خیابان|کوچه|کوی|بلوار|میدان|طبقه|واحد|محله|بن‌?بست|جاده|شهرک/u;

/**
 * A vehicle plate in what was said: it has a plate's shape, or names the vehicle, or says «پلاک» outside an
 * address. «… خیابان پاسداران، پلاک ۱۵۲» is a house number and is not one.
 */
export function mentionsVehiclePlate(text: string): boolean {
  if (!/پلاک/u.test(text)) return false;
  if (PLATE_SHAPE.test(text)) return true;
  if (new RegExp(`پلاک\\s*(?:ی\\s*)?${VEHICLE}|${VEHICLE}\\s*(?:با\\s*)?پلاک`, 'u').test(text)) return true;
  return !ADDRESS.test(text);
}

/** A load code or a vehicle plate, which speech gets wrong too often to run unchecked. */
export function hasVoiceIdentifier(text: string): boolean {
  return (
    /TRB|[a-z]{2,}[\s-]*[0-9۰-۹٠-٩]{2,}|تی[\s،,‌]*آر[\s،,‌]*بی|شماره\s*بار|بار\s*(?:شماره\s*)?[0-9۰-۹٠-٩]/iu.test(text) ||
    LOAD_CODE_WORD.test(text) ||
    mentionsVehiclePlate(text)
  );
}

export const VOICE_IDENTIFIER_NOTICE = 'کد بار یا پلاک ممکن است اشتباه شنیده شده باشد. لطفاً درخواست را همراه کد یا پلاک دقیق، به‌صورت متن بفرستید؛ همهٔ رقم‌ها و صفرها را بررسی کنید.';
