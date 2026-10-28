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
import { CargoTripType } from 'src/domain/enums/notification';
import { UpdateDriverProfileDto } from 'src/dto/notification/DriverProfileDto';
import { COMPANY_ROLES } from 'src/infrastructure/repositories/notification/cargoAudience.repository';
import { UserProfile, UserService } from '../UserService';
import { User } from 'src/domain/entities/auth/User';
import { DRIVERS_CHANGED_SOCKET_EVENT, NotificationsGateway } from '../notification/notifications.gateway';
import { evaluateVerification } from './driverVerification.service';
import { isBrokerOnly } from '../notification/loadRequesters';
import { DRIVER_KIND_TRIP_TYPES, driverKindForLoad, driverKindOf, driverTripTypes } from '../notification/cargoTripType';

// خارج از پوشه‌ی uploads که به‌صورت عمومی سرو می‌شود؛ فقط از راه API با توکن.
export const DRIVER_PHOTO_DIR = join(process.cwd(), 'private-uploads', 'driver-photos');

export const DRIVER_PHOTO_KINDS = ['face', 'vehicle', 'plate'] as const;

/** معرفی راننده به شرکتی که می‌خواهد بار را به او بسپارد (لیست انتخاب راننده). */
export interface DriverCard {
  userId: string;
  name: string;
  mobile: string | null;
  /** the account's own code (User.accountCode), to tell drivers apart on the phone */
  accountCode: string | null;
  vehicleType: string | null;
  vehicleModel: string | null;
  plate: string | null;
  capacityTons: number | null;
  homeCity: string | null;
  tripType: CargoTripType;
  // فقط وجود عکس؛ خود عکس از API شرکت با توکن
  photos: { face: boolean; vehicle: boolean };
  /** a broker (واسط) requested, not a driver: it has no vehicle; the company deals with it about the driver */
  broker: boolean;
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
// the web panel scales photos down before upload (a few hundred KB); this only stops oversized raw uploads
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

const USER_FIELDS = ['firstName', 'lastName', 'nationalCode'] as const;
const DRIVER_FIELDS = [
  'smartCardNumber',
  'licenseNumber',
  'birthDate',
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
 * A company a driver can join, with the name it uses for each kind of work; null where it does not do that kind.
 * The driver's panel lists domestic companies under «داخلی» and international ones under «بین‌المللی».
 */
export interface DriverCompanyOption {
  userId: string;
  name: string;
  /** شرکت مادر: بارش بی‌انتخاب هم می‌رسد (فقط فیلتر بار کنارش می‌گذارد) */
  isParent: boolean;
  domesticName: string | null;
  internationalName: string | null;
}

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
    private readonly gateway: NotificationsGateway,
  ) {}

  // صفحه‌ی «رانندگان» شرکت‌های آنلاین با این رویداد لیست را دوباره می‌گیرد (پنل و ربات هر دو از این سرویس رد می‌شوند).
  private changed(userId: string): void {
    this.gateway.sendToRoles(COMPANY_ROLES, DRIVERS_CHANGED_SOCKET_EVENT, { userId });
  }

  async get(userId: string) {
    const [user, driver] = await Promise.all([this.users.getProfile(userId), this.profiles.findOne({ where: { userId } })]);
    return this.toView(user, driver);
  }

  // فیلدی که نیامده دست نمی‌خورد؛ null پاکش می‌کند.
  async update(userId: string, dto: UpdateDriverProfileDto) {
    if (dto.companyUserIds !== undefined) {
      const valid = await this.availableCompanies(dto.companyUserIds);
      if (valid.length !== dto.companyUserIds.length) throw new BadRequestException('یکی از شرکت‌های حمل‌ونقل انتخاب‌شده فعال یا معتبر نیست.');
    }
    const userChanges = Object.fromEntries(USER_FIELDS.filter((f) => dto[f] !== undefined).map((f) => [f, dto[f]]));
    // راننده شخص حقیقی است؛ displayName در پنل از روی profileType نام را انتخاب می‌کند.
    const user = Object.keys(userChanges).length
      ? await this.users.updateProfile(userId, { ...userChanges, profileType: 0 })
      : await this.users.getProfile(userId);

    const driver = (await this.profiles.findOne({ where: { userId } })) ?? this.profiles.create({ userId });
    for (const field of DRIVER_FIELDS) {
      if (dto[field] !== undefined) Object.assign(driver, { [field]: dto[field] });
    }
    if (dto.cargoVoice !== undefined) driver.cargoVoice = dto.cargoVoice;
    // domestic or international: whatever load types were sent, the driver takes all the types of its kind
    if (dto.tripTypes !== undefined || dto.tripType !== undefined) {
      driver.tripTypes = driverTripTypes(dto.tripTypes ?? [dto.tripType]);
      driver.tripType = driver.tripTypes[0];
    }
    if (dto.companyUserIds !== undefined) driver.companyUserIds = dto.companyUserIds;
    const saved = await this.profiles.save(driver);
    this.changed(userId);
    return this.toView(user, saved);
  }

  /** فایل آپلودشده جای عکس قبلی می‌نشیند و قبلی پاک می‌شود. */
  async setPhoto(userId: string, kind: DriverPhotoKind, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('file is required.');
    const driver = (await this.profiles.findOne({ where: { userId } })) ?? this.profiles.create({ userId });
    const previous = driver[PHOTO_COLUMN[kind]];
    driver[PHOTO_COLUMN[kind]] = file.filename;
    await this.profiles.save(driver);
    await this.removeFile(previous);
    this.changed(userId);
    return this.get(userId);
  }

  async deletePhoto(userId: string, kind: DriverPhotoKind) {
    const driver = await this.profiles.findOne({ where: { userId } });
    const previous = driver?.[PHOTO_COLUMN[kind]];
    if (driver && previous) {
      driver[PHOTO_COLUMN[kind]] = null;
      await this.profiles.save(driver);
      await this.removeFile(previous);
      this.changed(userId);
    }
    return this.get(userId);
  }

  /** پیش‌فرض روشن: راننده‌ای که هنوز پروفایل ندارد هم صدا می‌گیرد. */
  async wantsCargoVoice(userId: string): Promise<boolean> {
    const driver = await this.profiles.findOne({ where: { userId }, select: { userId: true, cargoVoice: true } });
    return driver?.cargoVoice ?? true;
  }

  async setCargoVoice(userId: string, enabled: boolean): Promise<void> {
    await this.profiles.upsert({ userId, cargoVoice: enabled }, ['userId']);
  }

  /** کارت چند راننده به همان ترتیب userIds؛ کاربری که پیدا نشد حذف می‌شود. */
  async cards(userIds: string[]): Promise<DriverCard[]> {
    if (!userIds.length) return [];
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT u.id, u."firstName", u."lastName", u.username, u.mobile, u."accountCode", u."companyName",
              EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r.name = 'BROKER')
                AND p."userId" IS NULL AS broker,
              p."vehicleType", p."vehicleModel", p.plate, p."capacityTons", p."homeCity", p."facePhoto", p."vehiclePhoto", p."tripType"
         FROM "User" u LEFT JOIN "DriverProfile" p ON p."userId" = u.id
        WHERE u.id = ANY($1)`,
      [userIds],
    );
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    return userIds.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const broker = !!row.broker;
      const person = [row.firstName, row.lastName].filter(Boolean).join(' ');
      // a broker by the name it was approved with (its office), else like a driver
      const name = (broker && String(row.companyName ?? '').trim()) || person || String(row.username);
      return [
        {
          userId: id,
          name,
          broker,
          mobile: (row.mobile as string) ?? null,
          accountCode: (row.accountCode as string) ?? null,
          vehicleType: (row.vehicleType as string) ?? null,
          vehicleModel: (row.vehicleModel as string) ?? null,
          plate: (row.plate as string) ?? null,
          capacityTons: row.capacityTons === null || row.capacityTons === undefined ? null : Number(row.capacityTons),
          homeCity: (row.homeCity as string) ?? null,
          tripType: (row.tripType as CargoTripType) ?? CargoTripType.Domestic,
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

  async tripTypeOf(userId: string): Promise<CargoTripType> {
    const driver = await this.profiles.findOne({ where: { userId }, select: { userId: true, tripType: true } });
    return driver?.tripType ?? CargoTripType.Domestic;
  }

  // a broker (no driver profile) requests loads of every kind for its drivers
  async tripTypesOf(userId: string): Promise<CargoTripType[]> {
    const driver = await this.profiles.findOne({ where: { userId }, select: { userId: true, tripType: true, tripTypes: true } });
    if (!driver && (await this.isBroker(userId))) return Object.values(CargoTripType);
    return driverTripTypes(driver?.tripTypes?.length ? driver.tripTypes : [driver?.tripType]);
  }

  private async isBroker(userId: string): Promise<boolean> {
    const rows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT r.name FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $2 WHERE ur."userId" = $1`,
      [userId, RecordStatus.Active],
    );
    return isBrokerOnly(rows.map((row) => row.name));
  }

  // the parent company's loads reach every driver of the kind (CargoAudienceRepository.findDriverIds)
  async canReceiveAnnouncement(userId: string, publisherUserId: string, tripType: CargoTripType): Promise<boolean> {
    const [driver, publisher] = await Promise.all([
      this.profiles.findOne({ where: { userId } }),
      this.dataSource.getRepository(User).findOne({ where: { id: publisherUserId }, select: { id: true, isParentCompany: true } }),
    ]);
    const member = !!publisher?.isParentCompany || !!driver?.companyUserIds?.includes(publisherUserId);
    return !!driver && member && driverKindOf(driver.tripTypes ?? [driver.tripType]) === driverKindForLoad(tripType);
  }

  async availableCompanies(ids?: string[]): Promise<DriverCompanyOption[]> {
    if (ids && !ids.length) return [];
    const rows: DriverCompanyOption[] = await this.dataSource.query(
      `SELECT DISTINCT u.id AS "userId", u."isParentCompany" AS "isParent",
         COALESCE(NULLIF(u."companyName", ''), linked.name, NULLIF(concat_ws(' ', u."firstName", u."lastName"), ''), u.username) AS name,
         NULLIF(trim(u."domesticCompanyName"), '') AS "domesticName",
         NULLIF(trim(u."internationalCompanyName"), '') AS "internationalName"
       FROM "User" u
       JOIN "UserRole" ur ON ur."userId" = u.id
       JOIN "Role" r ON r.id = ur."roleId"
       LEFT JOIN LATERAL (
         SELECT c.name FROM "CompanyUser" cu JOIN "TransportCompany" c ON c.id = cu."transportCompanyId"
         WHERE cu."userId" = u.id AND cu."recordStatus" = $1
         ORDER BY cu."createdAt", cu.id LIMIT 1
       ) linked ON true
       WHERE u."recordStatus" = $1 AND r."recordStatus" = $1
         AND r.name IN ('COMPANY', 'COMPANY_ADMIN')
         ${ids ? 'AND u.id = ANY($2::uuid[])' : ''}
       ORDER BY "isParent" DESC, name, "userId"`,
      ids ? [RecordStatus.Active, ids] : [RecordStatus.Active],
    );
    // a company that named neither kind is under both, by its own name (as before the kinds had names)
    return rows.map((row) =>
      row.domesticName || row.internationalName ? row : { ...row, domesticName: row.name, internationalName: row.name },
    );
  }

  async setTripType(userId: string, tripType: CargoTripType): Promise<void> {
    const tripTypes = driverTripTypes([tripType]);
    await this.profiles.upsert({ userId, tripType: tripTypes[0], tripTypes }, ['userId']);
    this.changed(userId);
  }

  async setTripTypes(userId: string, tripTypes: CargoTripType[]): Promise<void> {
    if (!tripTypes.length) throw new BadRequestException('داخلی یا بین‌المللی بودن را انتخاب کنید.');
    const types = driverTripTypes(tripTypes);
    await this.profiles.upsert({ userId, tripTypes: types, tripType: types[0] }, ['userId']);
    this.changed(userId);
  }

  /**
   * راننده‌های فعال یک نوع (صفحه‌ی «رانندگان» شرکت)، به ترتیب نام؛ search در نام، موبایل
   * یا پلاک. راننده‌ی بدون پروفایل داخلی است. صادراتی یا وارداتی یعنی راننده‌های بین‌المللی.
   */
  async listByType(tripType: CargoTripType, page: number, pageSize: number, search?: string) {
    const term = search ? `%${toLatinDigits(search).trim().replace(/[\s-]/g, '')}%` : null;
    const where = `
         FROM "User" u
         JOIN "UserRole" ur ON ur."userId" = u.id
         JOIN "Role" r ON r.id = ur."roleId" AND r.name = 'DRIVER' AND r."recordStatus" = $1
         LEFT JOIN "DriverProfile" p ON p."userId" = u.id
        WHERE u."recordStatus" = $1 AND $2::varchar[] && COALESCE(p."tripTypes", ARRAY[COALESCE(p."tripType", '${CargoTripType.Domestic}')]::varchar[])
          AND ($3::text IS NULL
               OR replace(concat_ws('', u."firstName", u."lastName", u.username), ' ', '') ILIKE $3
               OR u.mobile ILIKE $3
               OR regexp_replace(coalesce(p.plate, ''), '[\s-]', '', 'g') ILIKE $3)`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(DISTINCT u.id)::int AS total ${where}`, [RecordStatus.Active, DRIVER_KIND_TRIP_TYPES[driverKindForLoad(tripType)], term]);
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT u.id, MIN(concat_ws(' ', u."firstName", u."lastName", u.username)) AS name ${where}
        GROUP BY u.id ORDER BY name LIMIT $4 OFFSET $5`,
      [RecordStatus.Active, DRIVER_KIND_TRIP_TYPES[driverKindForLoad(tripType)], term, pageSize, (page - 1) * pageSize],
    );
    return { items: await this.cards(rows.map((row) => row.id)), total: Number(total), page, pageSize };
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
      accountCode: user.accountCode ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      nationalCode: user.nationalCode ?? null,
      ...Object.fromEntries(DRIVER_FIELDS.map((f) => [f, driver?.[f] ?? null])),
      cargoVoice: driver?.cargoVoice ?? true,
      tripType: driver?.tripType ?? CargoTripType.Domestic,
      tripTypes: driverTripTypes(driver?.tripTypes?.length ? driver.tripTypes : [driver?.tripType]),
      driverKind: driverKindOf(driver?.tripTypes?.length ? driver.tripTypes : [driver?.tripType]),
      companyUserIds: driver?.companyUserIds ?? [],
      // فقط وجود عکس (و نسخه برای کش مرورگر)؛ خود فایل از GET profile/photos/:kind با توکن
      photos: {
        face: driver?.facePhoto ?? null,
        vehicle: driver?.vehiclePhoto ?? null,
        plate: driver?.platePhoto ?? null,
      },
      // نتیجه‌ی آخرین استعلام‌ها؛ استعلام جدید با POST profile/verify
      verification: evaluateVerification(user, driver),
    };
  }
}
