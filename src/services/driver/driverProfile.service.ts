import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { DataSource, Repository } from 'typeorm';

import { DriverProfile } from 'src/domain/entities/driver/DriverProfile';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { UpdateDriverProfileDto } from 'src/dto/notification/DriverProfileDto';
import { UserProfile, UserService } from '../UserService';

// خارج از پوشه‌ی uploads که به‌صورت عمومی سرو می‌شود؛ فقط از راه API با توکن.
export const DRIVER_PHOTO_DIR = join(process.cwd(), 'private-uploads', 'driver-photos');

export const DRIVER_PHOTO_KINDS = ['face', 'vehicle', 'plate'] as const;

/** معرفی راننده به شرکتی که می‌خواهد بار را به او بسپارد (لیست انتخاب راننده). */
export interface DriverCard {
  userId: string;
  name: string;
  mobile: string | null;
  vehicleType: string | null;
  vehicleModel: string | null;
  plate: string | null;
  capacityTons: number | null;
  homeCity: string | null;
  // فقط وجود عکس؛ خود عکس از API شرکت با توکن
  photos: { face: boolean; vehicle: boolean };
}

const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
export type DriverPhotoKind = (typeof DRIVER_PHOTO_KINDS)[number];

const PHOTO_COLUMN: Record<DriverPhotoKind, 'facePhoto' | 'vehiclePhoto' | 'platePhoto'> = {
  face: 'facePhoto',
  vehicle: 'vehiclePhoto',
  plate: 'platePhoto',
};
const PHOTO_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const USER_FIELDS = ['firstName', 'lastName', 'nationalCode'] as const;
const DRIVER_FIELDS = [
  'smartCardNumber',
  'licenseNumber',
  'homeCity',
  'vehicleType',
  'vehicleModel',
  'plate',
  'capacityTons',
  'fleetCardNumber',
] as const;

/** نام فایل همیشه UUID + پسوند از روی mimetype است، نه نام فایل کاربر. */
export const driverPhotoUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(DRIVER_PHOTO_DIR, { recursive: true });
      cb(null, DRIVER_PHOTO_DIR);
    },
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${PHOTO_EXTENSIONS[file.mimetype]}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (!PHOTO_EXTENSIONS[file.mimetype]) return cb(new BadRequestException('Only JPEG, PNG or WebP images are accepted.'), false);
    cb(null, true);
  },
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
};

/**
 * پروفایل راننده: نام و کد ملی روی User (همان که شرکت‌ها در درخواست می‌بینند)،
 * مدارک، ناوگان و عکس‌های اختیاری روی DriverProfile.
 */
@Injectable()
export class DriverProfileService {
  constructor(
    @InjectRepository(DriverProfile) private readonly profiles: Repository<DriverProfile>,
    private readonly dataSource: DataSource,
    private readonly users: UserService,
  ) {}

  async get(userId: string) {
    const [user, driver] = await Promise.all([this.users.getProfile(userId), this.profiles.findOne({ where: { userId } })]);
    return this.toView(user, driver);
  }

  // فیلدی که نیامده دست نمی‌خورد؛ null پاکش می‌کند.
  async update(userId: string, dto: UpdateDriverProfileDto) {
    const userChanges = Object.fromEntries(USER_FIELDS.filter((f) => dto[f] !== undefined).map((f) => [f, dto[f]]));
    // راننده شخص حقیقی است؛ displayName در پنل از روی profileType نام را انتخاب می‌کند.
    const user = Object.keys(userChanges).length
      ? await this.users.updateProfile(userId, { ...userChanges, profileType: 0 })
      : await this.users.getProfile(userId);

    const driver = (await this.profiles.findOne({ where: { userId } })) ?? this.profiles.create({ userId });
    for (const field of DRIVER_FIELDS) {
      if (dto[field] !== undefined) Object.assign(driver, { [field]: dto[field] });
    }
    return this.toView(user, await this.profiles.save(driver));
  }

  /** فایل آپلودشده جای عکس قبلی می‌نشیند و قبلی پاک می‌شود. */
  async setPhoto(userId: string, kind: DriverPhotoKind, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('file is required.');
    const driver = (await this.profiles.findOne({ where: { userId } })) ?? this.profiles.create({ userId });
    const previous = driver[PHOTO_COLUMN[kind]];
    driver[PHOTO_COLUMN[kind]] = file.filename;
    await this.profiles.save(driver);
    await this.removeFile(previous);
    return this.get(userId);
  }

  async deletePhoto(userId: string, kind: DriverPhotoKind) {
    const driver = await this.profiles.findOne({ where: { userId } });
    const previous = driver?.[PHOTO_COLUMN[kind]];
    if (driver && previous) {
      driver[PHOTO_COLUMN[kind]] = null;
      await this.profiles.save(driver);
      await this.removeFile(previous);
    }
    return this.get(userId);
  }

  /** کارت چند راننده به همان ترتیب userIds؛ کاربری که پیدا نشد حذف می‌شود. */
  async cards(userIds: string[]): Promise<DriverCard[]> {
    if (!userIds.length) return [];
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT u.id, u."firstName", u."lastName", u.username, u.mobile,
              p."vehicleType", p."vehicleModel", p.plate, p."capacityTons", p."homeCity", p."facePhoto", p."vehiclePhoto"
         FROM "User" u LEFT JOIN "DriverProfile" p ON p."userId" = u.id
        WHERE u.id = ANY($1)`,
      [userIds],
    );
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    return userIds.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || String(row.username);
      return [
        {
          userId: id,
          name,
          mobile: (row.mobile as string) ?? null,
          vehicleType: (row.vehicleType as string) ?? null,
          vehicleModel: (row.vehicleModel as string) ?? null,
          plate: (row.plate as string) ?? null,
          capacityTons: row.capacityTons === null || row.capacityTons === undefined ? null : Number(row.capacityTons),
          homeCity: (row.homeCity as string) ?? null,
          photos: { face: !!row.facePhoto, vehicle: !!row.vehiclePhoto },
        },
      ];
    });
  }

  /**
   * راننده‌ی ثبت‌نام‌شده در سامانه با موبایل یا پلاکِ کامل (نه بخشی از آن، تا فهرست
   * راننده‌ها با حدس زدن بیرون نرود). فقط کاربرهایی که نقش فعال DRIVER دارند.
   */
  async search(query: string, limit = 10): Promise<DriverCard[]> {
    const text = toLatinDigits(query).trim();
    const digits = text.replace(/\D/g, '');
    const mobile = /^(\+?98|0098)9\d{9}$/.test(text.replace(/[\s-]/g, '')) ? `0${digits.slice(-10)}` : /^09\d{9}$/.test(digits) ? digits : null;
    // پلاک بدون فاصله و خط تیره: «۱۲ ع ۳۴۵ ۶۷» همان «12-ع-345-67»
    const plate = text.replace(/[\s\-]/g, '');
    if (!mobile && plate.length < 7) return [];
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT DISTINCT u.id
         FROM "User" u
         JOIN "UserRole" ur ON ur."userId" = u.id
         JOIN "Role" r ON r.id = ur."roleId" AND r.name = 'DRIVER' AND r."recordStatus" = $3
         LEFT JOIN "DriverProfile" p ON p."userId" = u.id
        WHERE ($1::text IS NOT NULL AND u.mobile = $1)
           OR regexp_replace(coalesce(p.plate, ''), '[\s-]', '', 'g') = $2
        LIMIT ${Math.max(1, Math.min(limit, 20))}`,
      [mobile, plate, RecordStatus.Active],
    );
    return this.cards(rows.map((row) => row.id));
  }

  /** راننده‌ای با این شناسه و نقش فعال DRIVER هست؟ (قبل از سپردن بار) */
  async isDriver(userId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
        WHERE ur."userId" = $1 AND r.name = 'DRIVER' AND r."recordStatus" = $2 LIMIT 1`,
      [userId, RecordStatus.Active],
    );
    return rows.length > 0;
  }

  async photoPath(userId: string, kind: DriverPhotoKind): Promise<string> {
    const name = (await this.profiles.findOne({ where: { userId } }))?.[PHOTO_COLUMN[kind]];
    if (!name) throw new NotFoundException('Photo not found.');
    return join(DRIVER_PHOTO_DIR, name);
  }

  private async removeFile(name?: string | null) {
    if (name) await unlink(join(DRIVER_PHOTO_DIR, name)).catch(() => undefined);
  }

  private toView(user: UserProfile, driver: DriverProfile | null) {
    return {
      username: user.username,
      mobile: user.mobile ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      nationalCode: user.nationalCode ?? null,
      ...Object.fromEntries(DRIVER_FIELDS.map((f) => [f, driver?.[f] ?? null])),
      // فقط وجود عکس (و نسخه برای کش مرورگر)؛ خود فایل از GET profile/photos/:kind با توکن
      photos: {
        face: driver?.facePhoto ?? null,
        vehicle: driver?.vehiclePhoto ?? null,
        plate: driver?.platePhoto ?? null,
      },
    };
  }
}
