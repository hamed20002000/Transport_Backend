import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { Repository } from 'typeorm';

import { DriverProfile } from 'src/domain/entities/driver/DriverProfile';
import { UpdateDriverProfileDto } from 'src/dto/notification/DriverProfileDto';
import { UserProfile, UserService } from '../UserService';

// خارج از پوشه‌ی uploads که به‌صورت عمومی سرو می‌شود؛ فقط از راه API با توکن.
export const DRIVER_PHOTO_DIR = join(process.cwd(), 'private-uploads', 'driver-photos');

export const DRIVER_PHOTO_KINDS = ['vehicle', 'plate'] as const;
export type DriverPhotoKind = (typeof DRIVER_PHOTO_KINDS)[number];

const PHOTO_COLUMN: Record<DriverPhotoKind, 'vehiclePhoto' | 'platePhoto'> = { vehicle: 'vehiclePhoto', plate: 'platePhoto' };
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
        vehicle: driver?.vehiclePhoto ?? null,
        plate: driver?.platePhoto ?? null,
      },
    };
  }
}
