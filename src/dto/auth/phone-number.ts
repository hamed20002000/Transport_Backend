/** how many mobiles a profile's «موبایل اعلام بار» holds: with the company phone they fill a load's five */
export const MAX_CONTACT_MOBILES = 4;

/**
 * «موبایل اعلام بار» as people type it: mobiles separated by commas (, or ،), semicolons, spaces or new lines, each in
 * any usual form (+98…, Persian digits, 0912-123-4567). Two whole mobiles joined by a dash are two. Returns the
 * mobiles as 09xxxxxxxxx without repeats, [] for nothing typed, or null when a piece is not a mobile.
 */
export function parseMobileList(value: string): string[] | null {
  const pieces = value.split(/[,،;\n]+/).map((piece) => piece.trim()).filter(Boolean);
  const mobiles: string[] = [];
  for (const piece of pieces) {
    const whole = normalizePhoneNumber(piece.replace(/[\s-]/g, '')) as string;
    if (/^09[0-9]{9}$/.test(whole)) {
      mobiles.push(whole);
      continue;
    }
    // «09121234567 09351234567», «09121234567-09351234567»: whole mobiles joined by a space or a dash
    const parts = piece.split(/[\s-]+/).map((part) => normalizePhoneNumber(part) as string);
    if (parts.length < 2 || !parts.every((part) => /^09[0-9]{9}$/.test(part))) return null;
    mobiles.push(...parts);
  }
  return [...new Set(mobiles)];
}

export function normalizePhoneNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let phone = value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\s()-]/g, '');
  phone = phone.replace(/^(?:\+98|0098|98)(?=9)/, '0');
  return phone;
}
