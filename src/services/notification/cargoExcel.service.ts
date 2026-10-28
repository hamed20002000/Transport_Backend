import { BadRequestException, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import { CargoTripType } from '../../domain/enums/notification';
import { normalizePersianText } from '../../domain/helper/persianText';
import { CargoListingService } from './cargoListing.service';
import { CargoListingFields } from './cargoNotificationText';
import { CargoTripTypeService } from './cargoTripType';

// یک فایل = یک بار اعلام دسته‌جمعی؛ بیشتر از این را باید چند فایل کرد
export const MAX_EXCEL_ROWS = 200;
export const MAX_EXCEL_BYTES = 2 * 1024 * 1024;

// فایل نمونه‌ی قالب‌دار (رنگ، حاشیه، راست‌به‌چپ)؛ xlsx رایگان قالب‌بندی نمی‌نویسد، پس خود فایل
// فرستاده می‌شود. ردیف‌های خالی قالب‌دار فقط تا ۳۰۰ ردیف‌اند تا فایل پرشده سبک بماند.
const TEMPLATE_PATH = join(process.cwd(), 'src/services/notification/templates/cargo-template.xlsx');
// ردیف‌های بیشتر از این خوانده نمی‌شوند؛ فایلی که قالبش تا آخر اکسل کشیده شده هم سریع خوانده شود
const SCAN_ROWS = 1000;

type Column = 'origin' | 'destination' | 'cargoType' | 'weight' | 'vehicleType' | 'price' | 'extraNotes' | 'contactPhones';

/**
 * ستون‌هایی که خوانده می‌شوند (ترتیب مهم نیست؛ ستون ناشناخته نادیده گرفته می‌شود).
 * aliases: اسم‌هایی که شرکت ممکن است در سرستون بنویسد؛ سرستونی که یکی از این‌ها را دارد
 * («وزن بار (تن)») هم شناخته می‌شود. شماره تماس در فایل نمونه نیست و از پروفایل شرکت می‌آید.
 */
const COLUMNS: { key: Column; title: string; aliases: string[]; maxLength: number }[] = [
  { key: 'origin', title: 'مبدأ', aliases: ['مبدا', 'مبدأ', 'از'], maxLength: 200 },
  { key: 'destination', title: 'مقصد', aliases: ['مقصد', 'به'], maxLength: 200 },
  { key: 'cargoType', title: 'نوع بار', aliases: ['نوع بار', 'جنس', 'جنس بار', 'کالا'], maxLength: 200 },
  { key: 'weight', title: 'وزن بار', aliases: ['وزن بار', 'وزن', 'تناژ', 'تن'], maxLength: 100 },
  { key: 'vehicleType', title: 'نوع خودرو', aliases: ['نوع خودرو', 'خودرو', 'نوع ماشین', 'ماشین', 'بارگیر'], maxLength: 200 },
  { key: 'price', title: 'کرایه', aliases: ['کرایه', 'قیمت', 'نرخ'], maxLength: 100 },
  { key: 'extraNotes', title: 'توضیحات', aliases: ['توضیحات', 'توضیح', 'یادداشت'], maxLength: 1000 },
  { key: 'contactPhones', title: 'شماره تماس', aliases: ['شماره تماس', 'تلفن', 'تماس', 'موبایل'], maxLength: 200 },
];

const PHONE = /^[0-9۰-۹+\-\s()]{5,20}$/;

export interface ExcelCargoRow {
  /** شماره‌ی ردیف در اکسل (همان که کاربر می‌بیند؛ ردیف ۱ عنوان‌هاست) */
  row: number;
  fields: CargoListingFields;
  /** نوع بار از مبدأ و مقصد (پیش‌نمایش)؛ هنگام انتشار دوباره از مبدأ و مقصد تعیین می‌شود */
  tripType?: CargoTripType;
}

export interface ExcelCargoError {
  row: number;
  column?: string;
  message: string;
}

const key = (text: string) => normalizePersianText(text).replace(/[*:\s‌]/g, '').replace(/أ/g, 'ا');

const ALIASES = new Map<string, Column>(
  COLUMNS.flatMap((column) => [column.title, ...column.aliases].map((alias) => [key(alias), column.key] as [string, Column])),
);
// بلندترین اول: «نوع بار» پیش از «بار»، «وزن بار» پیش از «وزن»؛ «از»/«به» دوحرفی فقط دقیق
const CONTAINED = [...ALIASES.entries()].filter(([alias]) => alias.length > 2).sort(([a], [b]) => b.length - a.length);

function columnOf(title: string): Column | undefined {
  const name = key(title);
  if (!name) return undefined;
  return ALIASES.get(name) ?? CONTAINED.find(([alias]) => name.includes(alias))?.[1];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

/** اکسل صفر اول شماره‌ی موبایل را (اگر ستون عددی باشد) حذف می‌کند: 9121234567 → 09121234567 */
function phones(text: string): string[] {
  return text
    .split(/[،,;؛\n/|]+/)
    .map((phone) => phone.trim())
    .filter(Boolean)
    .map((phone) => (/^9\d{9}$/.test(phone) ? `0${phone}` : phone));
}

/**
 * ثبت چند بار با یک فایل اکسل: فایل نمونه، بررسی ردیف‌ها و اعلام همه برای راننده‌ها
 * (هر ردیف مثل «ثبت بار» دستی، CargoListingService.createManual).
 */
@Injectable()
export class CargoExcelService {
  constructor(
    private readonly listings: CargoListingService,
    private readonly tripTypes: CargoTripTypeService,
  ) {}

  template(): Buffer {
    return readFileSync(TEMPLATE_PATH);
  }

  /** ردیف‌های درست و خطاهای هر ردیف؛ شماره‌ی تماس خالی با شماره‌های پیش‌فرض شرکت پر می‌شود. */
  parse(file: Buffer, defaultPhones: string[]): { rows: ExcelCargoRow[]; errors: ExcelCargoError[] } {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file, { type: 'buffer', sheetRows: SCAN_ROWS });
    } catch {
      throw new BadRequestException('فایل اکسل خوانده نشد؛ فایل نمونه را دانلود و پر کنید.');
    }
    const sheet = workbook.SheetNames.length ? workbook.Sheets[workbook.SheetNames[0]] : undefined;
    if (!sheet) throw new BadRequestException('فایل اکسل خالی است.');

    const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true, raw: true });
    const header = (table[0] ?? []).map((title) => columnOf(cellText(title)));
    for (const required of ['origin', 'destination'] as const) {
      if (!header.includes(required)) {
        const title = COLUMNS.find((column) => column.key === required)!.title;
        throw new BadRequestException(`ستون «${title}» در ردیف اول فایل نیست؛ از فایل نمونه استفاده کنید.`);
      }
    }

    const rows: ExcelCargoRow[] = [];
    const errors: ExcelCargoError[] = [];
    table.slice(1).forEach((cells, index) => {
      const row = index + 2;
      const values: Partial<Record<Column, string>> = {};
      header.forEach((column, i) => {
        const text = cellText(cells[i]);
        if (column && text) values[column] = values[column] ? `${values[column]} ${text}` : text;
      });
      if (!Object.keys(values).length) return; // ردیف خالی

      const rowErrors: ExcelCargoError[] = [];
      for (const column of COLUMNS) {
        if ((values[column.key]?.length ?? 0) > column.maxLength) {
          rowErrors.push({ row, column: column.title, message: `«${column.title}» بیشتر از ${column.maxLength} حرف است.` });
        }
      }
      if (!values.origin) rowErrors.push({ row, column: 'مبدأ', message: 'مبدأ خالی است.' });
      if (!values.destination) rowErrors.push({ row, column: 'مقصد', message: 'مقصد خالی است.' });

      const contactPhones = values.contactPhones ? phones(values.contactPhones) : defaultPhones;
      if (!contactPhones.length) {
        rowErrors.push({ row, column: 'شماره تماس', message: 'شماره تماس خالی است و شماره‌ای هم در پروفایل شرکت حمل‌ونقل یا شرکت / کارخانه نیست.' });
      } else if (contactPhones.length > 5 || contactPhones.some((phone) => !PHONE.test(phone))) {
        rowErrors.push({ row, column: 'شماره تماس', message: 'شماره تماس درست نیست (حداکثر ۵ شماره، با ویرگول جدا).' });
      }

      if (rowErrors.length) {
        errors.push(...rowErrors);
        return;
      }
      rows.push({
        row,
        fields: {
          origin: values.origin!,
          destination: values.destination!,
          cargoType: values.cargoType ?? null,
          weight: values.weight ?? null,
          vehicleType: values.vehicleType ?? null,
          price: values.price ?? null,
          extraNotes: values.extraNotes ?? null,
          contactPhones,
        },
      });
    });

    if (!rows.length && !errors.length) throw new BadRequestException('هیچ باری در فایل نیست.');
    if (rows.length + new Set(errors.map((error) => error.row)).size > MAX_EXCEL_ROWS) {
      throw new BadRequestException(`حداکثر ${MAX_EXCEL_ROWS} بار در هر فایل؛ بارها را در چند فایل بارگذاری کنید.`);
    }
    return { rows, errors };
  }

  /**
   * بررسی فایل بدون ثبت؛ شماره تماس خالی با شماره‌های پروفایل شرکت پر می‌شود. نوع بار
   * (داخلی/صادراتی/وارداتی) هر ردیف از مبدأ و مقصد تعیین می‌شود تا شرکت پیش از انتشار ببیند
   * بار به کدام راننده‌ها می‌رسد.
   */
  async check(userId: string, file: Buffer) {
    const defaults = await this.listings.buildManualDraft(userId);
    const { rows, errors } = this.parse(file, defaults.contactPhones);
    // مسیرهای تکراری یک بار مکان‌یابی می‌شوند (Nominatim یک درخواست در ثانیه)
    const byRoute = new Map<string, CargoTripType>();
    for (const row of rows) {
      const route = `${row.fields.origin}\u0000${row.fields.destination}`;
      if (!byRoute.has(route)) byRoute.set(route, await this.tripTypes.classifyListing(row.fields.origin, row.fields.destination));
      row.tripType = byRoute.get(route);
    }
    return { rows, errors };
  }

  /** انتشار ردیف‌های بررسی‌شده، هر کدام مثل «ثبت بار» دستی، به نام شرکت. */
  async publish(userId: string, rows: ExcelCargoRow[]) {
    const { companyName } = await this.listings.buildManualDraft(userId);
    const created: { row: number; id: string; code: string | null; origin: string; destination: string; recipients: number; tripType: string; pending: boolean; pendingReason: 'automatic' | 'noDrivers' | null }[] = [];
    for (const { row, fields } of rows) {
      const listing = await this.listings.createManual(userId, { ...fields, companyName });
      created.push({
        row,
        id: listing.id,
        code: listing.code ?? null,
        origin: listing.origin,
        destination: listing.destination,
        recipients: listing.recipients,
        tripType: listing.tripType,
        // اعلام خودکار: در صف نوبت بعدی
        pending: listing.pending,
        // automatic: در صف نوبت بعدی؛ noDrivers: دستی، ولی راننده‌ی مناسبی نبود
        pendingReason: 'pendingReason' in listing ? listing.pendingReason : null,
      });
    }
    return created;
  }

  /**
   * همه‌ی ردیف‌ها اول بررسی می‌شوند؛ اگر یکی ایراد داشت هیچ باری ثبت نمی‌شود تا بارگذاری
   * دوباره‌ی فایل اصلاح‌شده بار تکراری نسازد. dryRun: فقط بررسی و پیش‌نمایش.
   */
  async import(userId: string, file: Buffer, dryRun = false) {
    const { rows, errors } = await this.check(userId, file);
    if (errors.length || dryRun) {
      return { created: [], rows: rows.map(({ row, fields, tripType }) => ({ row, ...fields, tripType })), errors, dryRun };
    }
    return { created: await this.publish(userId, rows), rows: [], errors: [], dryRun };
  }
}
