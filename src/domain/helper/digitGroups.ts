const DIGIT = '0-9۰-۹٠-٩';

// a bare run of 4+ digits; not a fraction («۲۲/۵۰۰۰»), a date or time («۱۴۰۵/۰۸/۱۲», «۱۲:۳۰»), or already grouped
const RUN = new RegExp(`(?<![${DIGIT}.,٬٫/:+])[${DIGIT}]{4,}(?![${DIGIT}]|[/:][${DIGIT}])`, 'g');

/**
 * Thousands separators in free text, the way people read amounts: «۴۵۰۰۰۰۰۰ تومان» → «۴۵٬۰۰۰٬۰۰۰ تومان»,
 * «22000 kg» → «22,000 kg». Persian digits get «٬», Latin ones «,». A run starting with zero (a phone number)
 * is left alone, and so is anything already grouped, so applying it twice changes nothing.
 * Same rules as groupDigits in transport_front (src/shared/utils/digitGroups.ts).
 */
export function groupDigits(text: string): string;
export function groupDigits(text: string | null | undefined): string | null | undefined;
export function groupDigits(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  return text.replace(RUN, (run) => {
    if (/^[0۰٠]/.test(run)) return run;
    const separator = /[0-9]/.test(run) ? ',' : '٬';
    return run.replace(/(?!^)(?=(?:.{3})+$)/gu, separator);
  });
}

/** A load's weight or price grouped, unless the separators would push it past its column (100 characters). */
export const groupedField = (value: string | null | undefined, max = 100) => ((groupDigits(value)?.length ?? 0) <= max ? groupDigits(value) : value);
