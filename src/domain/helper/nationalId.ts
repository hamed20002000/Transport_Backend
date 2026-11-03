// the weights of the 10 digits before the check digit
const WEIGHTS = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];

/**
 * A company's national ID (شناسه ملی اشخاص حقوقی) is real: 11 digits, the last one the check digit of the others
 * (each digit plus the tenth digit + 2, times its weight, summed, mod 11; 10 counts as 0). Same check in
 * transport_front (src/shared/utils/nationalId.ts).
 */
export function isCompanyNationalId(value: string | null | undefined): boolean {
  if (!value || !/^[0-9]{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const shift = digits[9] + 2;
  const sum = WEIGHTS.reduce((total, weight, i) => total + (digits[i] + shift) * weight, 0);
  const check = sum % 11 === 10 ? 0 : sum % 11;
  return check === digits[10];
}
