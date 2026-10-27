import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

import { normalizePersianText } from 'src/domain/helper/persianText';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { MAX_DRIVER_INVITES } from './driverInvite.service';

export const MAX_DRIVER_EXCEL_BYTES = 2 * 1024 * 1024;
// rows past this are not read: a sheet whose formatting runs to the end of Excel is still read quickly
const SCAN_ROWS = 1000;

const MOBILE = /^09[0-9]{9}$/;

const key = (text: string) => normalizePersianText(text).replace(/[*:\s‌_-]/g, '');

// header titles a company may use, the surest first («شماره موبایل» before a «شماره پلاک» column's «شماره»);
// family before name, so «نام خانوادگی» is not taken as «نام»
const TITLES: Array<['mobile' | 'name' | 'family', string[]]> = [
  ['mobile', ['شماره موبایل', 'موبایل', 'شماره همراه', 'همراه', 'شماره تلفن', 'تلفن', 'شماره تماس', 'شماره', 'mobile', 'phone']],
  ['family', ['نام خانوادگی', 'فامیلی', 'family', 'lastname']],
  ['name', ['نام و نام خانوادگی', 'نام راننده', 'نام کامل', 'راننده', 'نام', 'name', 'firstname']],
];
const MOBILE_TITLES = TITLES[0][1].map(key);

export interface DriverExcelRow {
  /** the row number the company sees in Excel */
  row: number;
  mobile: string;
  name?: string;
}

export interface DriverExcelResult {
  drivers: DriverExcelRow[];
  errors: Array<{ row: number; message: string }>;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** A cell as a mobile number; Excel drops the leading zero of a number column (9121234567). */
function mobileOf(text: string): string | null {
  const phone = normalizePhoneNumber(text) as string;
  const mobile = /^9[0-9]{9}$/.test(phone) ? `0${phone}` : phone;
  return MOBILE.test(mobile) ? mobile : null;
}

/**
 * The drivers of an Excel file: the columns by their titles («شماره موبایل»، «نام راننده»، or «نام» and «نام خانوادگی»),
 * in any order; a sheet without titles: the column whose cells are mobile numbers, and the first text column beside it
 * as the name. Duplicate numbers are kept once; a row without a valid number is an error, the others still come back.
 */
export function readDriverExcel(file: Buffer): DriverExcelResult {
  let rows: unknown[][];
  try {
    const book = XLSX.read(file, { type: 'buffer', sheetRows: SCAN_ROWS + 1 });
    const sheet = book.Sheets[book.SheetNames[0]];
    rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: '', raw: true }) : [];
  } catch {
    throw new BadRequestException('فایل اکسل خوانده نشد؛ فایل xlsx یا xls بفرستید.');
  }
  const texts = rows.map((row) => row.map(cellText));
  const width = Math.max(0, ...texts.map((row) => row.length));

  // titled: the first row that names a mobile column
  const columns: Partial<Record<'mobile' | 'name' | 'family', number>> = {};
  let first = 0;
  const titled = texts.slice(0, 5).findIndex((row) => row.some((cell) => MOBILE_TITLES.some((title) => key(cell).includes(title))));
  if (titled >= 0) {
    const titles = texts[titled].map(key);
    const used = new Set<number>();
    for (const [column, names] of TITLES) {
      for (const name of names.map(key)) {
        const index = titles.findIndex((title, i) => title && !used.has(i) && title.includes(name));
        if (index < 0) continue;
        columns[column] = index;
        used.add(index);
        break;
      }
    }
    first = titled + 1;
  } else {
    // untitled: the column with the most mobile numbers, then the first column of other text
    const counts = Array.from({ length: width }, (_, index) => texts.filter((row) => mobileOf(row[index] ?? '')).length);
    const best = counts.indexOf(Math.max(0, ...counts));
    if (best < 0 || counts[best] === 0) throw new BadRequestException('ستون شماره موبایل پیدا نشد؛ سرستون «شماره موبایل» بگذارید.');
    columns.mobile = best;
    const name = Array.from({ length: width }, (_, index) => index).find(
      (index) => index !== best && texts.some((row) => row[index] && !/^[0-9۰-۹+\s()-]+$/.test(row[index])),
    );
    if (name !== undefined) columns.name = name;
  }

  const result: DriverExcelResult = { drivers: [], errors: [] };
  const seen = new Set<string>();
  texts.slice(first).forEach((row, offset) => {
    const at = first + offset + 1;
    if (!row.some(Boolean)) return;
    const raw = row[columns.mobile!] ?? '';
    const mobile = mobileOf(raw);
    if (!mobile) {
      result.errors.push({ row: at, message: raw ? `«${raw}» شماره موبایل معتبر نیست.` : 'شماره موبایل ندارد.' });
      return;
    }
    if (seen.has(mobile)) return;
    seen.add(mobile);
    const name = [columns.name, columns.family].map((index) => (index === undefined ? '' : row[index] ?? '')).filter(Boolean).join(' ').slice(0, 200);
    result.drivers.push({ row: at, mobile, ...(name && { name }) });
  });
  if (!result.drivers.length && !result.errors.length) throw new BadRequestException('فایل خالی است.');
  if (result.drivers.length > MAX_DRIVER_INVITES) {
    throw new BadRequestException(`در هر فایل حداکثر ${MAX_DRIVER_INVITES} راننده؛ فایل را چند بخش کنید.`);
  }
  return result;
}

/** The sample file: the two columns, right-to-left. */
export function driverExcelTemplate(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['شماره موبایل', 'نام راننده'],
    ['09121234567', 'علی رضایی'],
  ]);
  sheet['!cols'] = [{ wch: 18 }, { wch: 28 }];
  // the numbers as text, so Excel keeps their leading zero
  sheet['A2'].t = 's';
  sheet['A2'].z = '@';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'رانندگان');
  book.Workbook = { Views: [{ RTL: true }] };
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
