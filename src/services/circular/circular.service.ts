import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Circular } from 'src/domain/entities/notification/Circular';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { IBotLinkRepository } from 'src/domain/repositories/messengerBot/IBotLinkRepository';
import { BOT_LINK_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { sendThroughOne } from '../notification/messengerOrder';
import { WebPushService } from '../notification/webPush.service';
import { WhatsappDialogBridge } from '../notification/whatsappDialogBridge';

// outside the public /uploads: drivers get a file through the API, signed in
export const CIRCULAR_DIR = join(process.cwd(), 'private-uploads', 'circulars');
const FILE_TYPES: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// between two drivers of the announcement: the bots' limits (WhatsApp keeps its own gap, WHATSAPP_NOTIFICATION_MIN_GAP_MS)
const BETWEEN_DRIVERS_MS = 150;
const DRIVER_PAGE = '/account/driver/circulars';

/** The upload: a PDF or a picture up to 10 MB, kept under a random name. */
export const circularUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(CIRCULAR_DIR, { recursive: true });
      cb(null, CIRCULAR_DIR);
    },
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${FILE_TYPES[file.mimetype] ?? extname(file.originalname)}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (!FILE_TYPES[file.mimetype]) return cb(new BadRequestException('فقط فایل PDF یا تصویر (JPG، PNG یا WebP) قابل بارگذاری است.'), false);
    cb(null, true);
  },
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
};

/** A circular as the panels show it (the file only as whether there is one; it comes from its own endpoint). */
export interface CircularView {
  id: string;
  title: string;
  body: string | null;
  file: { name: string; mimeType: string; size: number } | null;
  createdAt: Date;
}

/**
 * بخشنامه‌ها: ادمین عنوان، متن و فایل (اختیاری) بارگذاری می‌کند و همان لحظه به همه‌ی راننده‌های فعال خبر داده
 * می‌شود: پوش، و پیام در یکی از پیام‌رسان‌های هر راننده (ربات یا واتساپ، به ترتیب MESSENGER_ORDER) با لینک صفحه‌ی
 * بخشنامه‌های پنل. خبر رساندن در پس‌زمینه و راننده به راننده است تا پیام‌رسان‌ها یک‌جا پر نشوند.
 */
@Injectable()
export class CircularService {
  private readonly logger = new Logger(CircularService.name);

  constructor(
    @InjectRepository(Circular) private readonly circulars: Repository<Circular>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly push: WebPushService,
    private readonly bots: MessengerBotService,
    private readonly whatsapp: WhatsappDialogBridge,
    @Inject(BOT_LINK_REPOSITORY) private readonly botLinks: IBotLinkRepository,
  ) {}

  /** A new circular; every driver hears of it in the background. */
  async create(adminUserId: string, title: string, body: string | null, file?: Express.Multer.File) {
    const circular = await this.circulars.save(
      this.circulars.create({
        title: title.trim(),
        body: body?.trim() || null,
        fileName: file?.filename ?? null,
        originalName: file ? Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200) : null,
        mimeType: file?.mimetype ?? null,
        size: file?.size ?? null,
        createdByUserId: adminUserId,
      }),
    );
    void this.announce(circular.id).catch((error: Error) => this.logger.error(`Circular ${circular.id} announcement failed: ${error.message}`));
    return this.adminView(circular);
  }

  /** The admin's list, with how far each announcement got. */
  async adminList() {
    const rows = await this.circulars.find({ where: { deletedAt: IsNull() }, order: { createdAt: 'DESC' }, take: 200 });
    return rows.map((row) => this.adminView(row));
  }

  /** The drivers' list, newest first. */
  async list(): Promise<CircularView[]> {
    const rows = await this.circulars.find({ where: { deletedAt: IsNull() }, order: { createdAt: 'DESC' }, take: 200 });
    return rows.map((row) => this.view(row));
  }

  async remove(id: string): Promise<{ id: string }> {
    const circular = await this.circulars.findOne({ where: { id, deletedAt: IsNull() } });
    if (!circular) throw new NotFoundException('بخشنامه پیدا نشد.');
    await this.circulars.update({ id }, { deletedAt: new Date() });
    if (circular.fileName) await unlink(join(CIRCULAR_DIR, circular.fileName)).catch(() => undefined);
    return { id };
  }

  /** The stored file of a circular still shown, and how to name it for the download. */
  async file(id: string): Promise<{ path: string; name: string; mimeType: string }> {
    const circular = await this.circulars.findOne({ where: { id, deletedAt: IsNull() } });
    if (!circular?.fileName) throw new NotFoundException('این بخشنامه فایل ندارد.');
    return { path: join(CIRCULAR_DIR, circular.fileName), name: circular.originalName ?? circular.fileName, mimeType: circular.mimeType ?? 'application/octet-stream' };
  }

  /**
   * Every active driver hears of the circular: a push, and its one messenger (a bot, or WhatsApp with its own gap
   * between messages). One driver after the other, counting how many it reached.
   */
  async announce(id: string): Promise<void> {
    const circular = await this.circulars.findOne({ where: { id } });
    if (!circular) return;
    const drivers: Array<{ id: string }> = await this.dataSource.query(
      `SELECT DISTINCT u.id FROM "User" u
         JOIN "UserRole" ur ON ur."userId" = u.id
         JOIN "Role" r ON r.id = ur."roleId" AND r.name = 'DRIVER' AND r."recordStatus" = $1
        WHERE u."recordStatus" = $1`,
      [RecordStatus.Active],
    );
    await this.circulars.update({ id }, { recipients: drivers.length, notified: 0 });
    const panel = this.config.get<string>('WEB_PANEL_URL')?.trim().replace(/\/+$/, '');
    const excerpt = circular.body ? `\n\n${circular.body.length > 300 ? `${circular.body.slice(0, 300)}…` : circular.body}` : '';
    const text = `📢 بخشنامه‌ی تازه\n\n${circular.title}${excerpt}${circular.fileName ? '\n\n📎 فایل بخشنامه' : ''}\nمتن کامل در پنل ترابوت: ${panel ? `${panel}${DRIVER_PAGE}` : 'بخش «بخشنامه‌ها»'}`;

    let notified = 0;
    for (const [index, driver] of drivers.entries()) {
      const reached = await this.notify(driver.id, circular, text);
      if (reached) notified++;
      // the admin's list shows how far it got
      if (index % 20 === 19) await this.circulars.update({ id }, { notified });
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_DRIVERS_MS));
    }
    await this.circulars.update({ id }, { notified, notifiedAt: new Date() });
    this.logger.log(`Circular ${id} announced to ${notified} of ${drivers.length} driver(s)`);
  }

  /** One driver: a push (on whatever devices it allowed) and its messenger; whether the messenger took it. */
  private async notify(userId: string, circular: Circular, text: string): Promise<boolean> {
    await this.push
      .sendToUser(userId, { title: 'ترابوت · بخشنامه‌ی تازه', body: circular.title, url: DRIVER_PAGE, tag: 'circulars', renotify: true })
      .catch((error: Error) => this.logger.warn(`Circular push to ${userId} failed: ${error.message}`));
    const messenger = await sendThroughOne(
      await this.botLinks.findAllByUserId(userId),
      (platform) => this.bots.hasPlatform(platform),
      { bot: (link) => this.bots.sendNotification(link.chatId, text), whatsapp: () => this.whatsapp.notify(userId, text) },
      (channel, error) => this.logger.warn(`Circular to ${userId} on ${channel} failed: ${error.message}`),
    ).catch(() => null);
    return !!messenger;
  }

  private view(row: Circular): CircularView {
    return {
      id: row.id,
      title: row.title,
      body: row.body ?? null,
      file: row.fileName ? { name: row.originalName ?? row.fileName, mimeType: row.mimeType ?? '', size: row.size ?? 0 } : null,
      createdAt: row.createdAt,
    };
  }

  private adminView(row: Circular) {
    return { ...this.view(row), recipients: row.recipients, notified: row.notified, notifiedAt: row.notifiedAt ?? null };
  }
}
