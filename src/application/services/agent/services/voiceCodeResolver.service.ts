import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { applyResolvedCode, CodeCandidate, matchSpokenCode, spokenNumbers } from './spokenCodes';
import { hasVoiceIdentifier, mentionsVehiclePlate } from './voiceIdentifiers';

// فقط بارهای اخیر -- راننده درباره‌ی بار ماه‌های قبل دستور نمی‌ده و کاندیدای کمتر یعنی تطبیق مطمئن‌تر.
const CANDIDATE_DAYS = 30;
const MAX_CANDIDATES = 300;

export type VoiceCodeResolution =
  /** کدی در متن نیست -- همون مسیر قبلی (تایید متن) */
  | { kind: 'none' }
  /** کد یا پلاک داره ولی با هیچ بار کاربر جور نشد -- باید تایپ کنه */
  | { kind: 'unresolved' }
  /** دقیقاً یک بار جور شد -- متن با کد دقیق بازنویسی شده و توضیح مسیر برای تایید */
  | { kind: 'resolved'; text: string; label: string }
  /** چند بار نزدیک -- کاربر یکی رو انتخاب می‌کنه */
  | { kind: 'choose'; options: { text: string; label: string }[] };

/**
 * کد بارِ گفته‌شده در ویس رو با بارهای واقعیِ همون کاربر تطبیق می‌ده: بارهایی که
 * برای راننده/شرکت اعلام شده (CargoNotification) و بارهایی که خودش منتشر کرده
 * (CargoListing). whisper کد رو تقریباً هیچ‌وقت دقیق نمی‌نویسه («ده هزار نه»،
 * «TRB 1009»)، ولی هر کاربر فقط چند ده بار جلوی خودش داره.
 */
@Injectable()
export class VoiceCodeResolverService {
  private readonly logger = new Logger(VoiceCodeResolverService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolve(userId: string, text: string): Promise<VoiceCodeResolution> {
    const mentionsIdentifier = hasVoiceIdentifier(text);
    // عدد بلند بدون کلمه‌ی «کد/TRB» هم احتمالاً کده («ده هزار نه رو اعلام کن»).
    const hasLongNumber = spokenNumbers(text).some((number) => number.readings.some((reading) => reading.length >= 4));
    if (!mentionsIdentifier && !hasLongNumber) return { kind: 'none' };
    // پلاک ماشین با کد بار جور نمی‌شه و حدس زدنش خطرناکه (پلاکِ نشانی، شماره‌ی خانه است و مانعی نیست).
    if (mentionsVehiclePlate(text)) return { kind: 'unresolved' };

    let candidates: CodeCandidate[];
    try {
      candidates = await this.candidates(userId);
    } catch (error) {
      this.logger.error(`Loading cargo codes for voice failed (${userId})`, error as Error);
      return mentionsIdentifier ? { kind: 'unresolved' } : { kind: 'none' };
    }

    const match = matchSpokenCode(text, candidates);
    if (!match) return mentionsIdentifier ? { kind: 'unresolved' } : { kind: 'none' };

    const options = match.options
      .map((option) => ({ text: applyResolvedCode(text, match.span, option.code), label: option.label ?? option.code }))
      .filter((option): option is { text: string; label: string } => option.text !== null);
    if (options.length === 0) return { kind: 'unresolved' };
    if (options.length === 1) return { kind: 'resolved', ...options[0] };
    return { kind: 'choose', options };
  }

  private async candidates(userId: string): Promise<CodeCandidate[]> {
    const rows: { code: string; origin: string | null; destination: string | null }[] = await this.dataSource.query(
      `SELECT code, origin, destination FROM (
         SELECT l.code, l.origin, l.destination, n."createdAt" AS at
           FROM "CargoNotification" n JOIN "CargoListing" l ON l.id = n."listingId"
          WHERE n."userId"::text = $1 AND n."createdAt" > now() - make_interval(days => $2)
         UNION ALL
         SELECT n.payload->>'code', n.payload->>'origin', n.payload->>'destination', n."createdAt"
           FROM "CargoNotification" n
          WHERE n."userId"::text = $1 AND n."listingId" IS NULL AND n.payload->>'code' IS NOT NULL
            AND n."createdAt" > now() - make_interval(days => $2)
         UNION ALL
         SELECT l.code, l.origin, l.destination, l."createdAt"
           FROM "CargoListing" l
          WHERE l."publisherUserId"::text = $1 AND l."createdAt" > now() - make_interval(days => $2)
       ) AS c
       ORDER BY at DESC
       LIMIT $3`,
      [userId, CANDIDATE_DAYS, MAX_CANDIDATES],
    );

    const byCode = new Map<string, CodeCandidate>();
    for (const row of rows) {
      if (!row.code || byCode.has(row.code)) continue;
      const route = row.origin && row.destination ? `${row.origin} ← ${row.destination}` : row.origin || row.destination;
      byCode.set(row.code, { code: row.code, label: route ? `${row.code} (${route})` : row.code });
    }
    return [...byCode.values()];
  }
}
