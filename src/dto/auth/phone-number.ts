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
