import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { normalizePersianText } from '../../domain/helper/persianText';
import { RedisService } from '../redis/redis.service';

/** آمار اخیر هر مرز در فهرست borderpark (تعداد ناوگان). */
export interface BorderStats {
  load: number;
  transit: number;
  export: number;
  unload: number;
  customsCheckedIn: number;
}

export interface BorderSummary {
  /** شناسه‌ی پایدار، مثل «bazargan» (از APIRouteAddress) */
  id: string;
  name: string;
  country: string;
  countryCode: string;
  stats: BorderStats;
}

/** یک صف نوبت‌دهی در مرز؛ برچسب‌ها همان برچسب‌های سایت borderpark است. */
export interface BorderQueue {
  title: string;
  /** کل صف */
  inQueue: number;
  /** از کل صف، ناوگانی که هنوز در مرز حاضر نیست (نوبت اینترنتی) */
  notPresent: number;
  /** ناوگان فاقد بار */
  empty: number;
  /** فراخوان‌شده */
  called: number;
  /** پذیرش گمرک */
  customsCheckedIn: number;
  /** در انتظار ورود به گمرک (از تیرپارک خارج شده) */
  waitingCustoms: number;
  /** زمان انتظار تا فراخوان، ساعت */
  waitHours: number;
}

export interface Tirpark {
  name: string;
  address: string;
  capacity: number;
  /** نوع صف‌هایی که این تیرپارک می‌پذیرد */
  accepts: string[];
  lat: number;
  lng: number;
}

export interface BorderDetail {
  border: BorderSummary;
  /** زمان آخرین به‌روزرسانی borderpark (شمسی، «۱۴۰۵-۰۷-۲۳ ۲۰:۳۸») */
  lastUpdate: string | null;
  totals: { inQueue: number; called: number; customsCheckedIn: number };
  /** صف‌های غیرخالی، شلوغ‌ترین اول */
  queues: BorderQueue[];
  /** اطلاعیه‌های مرز برای رانندگان (فقط فارسی) */
  notices: string[];
  tirparks: Tirpark[];
  /** borderpark در دسترس نبود و این آخرین داده‌ی ذخیره‌شده است */
  stale: boolean;
}

const BASE_URL = 'https://borderpark.ir';
const TIMEOUT_MS = 15_000;
// صف‌ها چند دقیقه یک‌بار در borderpark به‌روز می‌شوند
const STATUS_FRESH_MS = 10 * 60 * 1000;
const TIRPARKS_FRESH_MS = 24 * 60 * 60 * 1000;
// داده‌ی قدیمی برای وقتی که borderpark در دسترس نیست
const KEEP_SECONDS = 3 * 24 * 60 * 60;

interface Cached<T> {
  at: number;
  data: T;
}

const num = (value: unknown) => {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
// borderpark «ي» و «ك» عربی و فاصله‌های اضافه دارد
const text = (value: unknown) =>
  String(value ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * وضعیت مرزهای زمینی از borderpark.ir (عمومی، بدون کلید): فهرست مرزها با آمار،
 * و برای هر مرز صف‌های نوبت‌دهی، اطلاعیه‌ها و تیرپارک‌ها. هر داده کش می‌شود و
 * اگر borderpark در دسترس نبود آخرین داده با stale نشان داده می‌شود.
 */
@Injectable()
export class BorderStatusService {
  private readonly logger = new Logger(BorderStatusService.name);
  private readonly baseUrl: string;
  // درخواست هم‌زمان برای یک داده فقط یک بار به borderpark می‌رود
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('BORDERPARK_URL', BASE_URL).replace(/\/$/, '');
  }

  async borders(): Promise<BorderSummary[]> {
    const { data } = await this.cached('list', 'all', STATUS_FRESH_MS, async () => {
      const body = await this.get<{ Borders?: Record<string, unknown>[] }>('/api/Border/List/Fa');
      return (body.Borders ?? [])
        .filter((border) => border.Enabled !== false && border.APIRouteAddress)
        .map((border) => this.summary(border));
    });
    return data;
  }

  async detail(id: string): Promise<BorderDetail | null> {
    const border = (await this.borders()).find((item) => item.id === id);
    if (!border) return null;
    const route = `/${border.id}-api`;
    const [status, notices, tirparks] = await Promise.all([
      this.cached('status', border.id, STATUS_FRESH_MS, async () => {
        const body = await this.get<{ LastUpdate?: string; QueueStatusList?: Record<string, unknown>[] }>(`${route}/BorderQueue/LastStatusII/Fa`);
        return { lastUpdate: body.LastUpdate ? text(body.LastUpdate) : null, queues: (body.QueueStatusList ?? []).map((queue) => this.queue(queue)) };
      }),
      this.cached('notices', border.id, STATUS_FRESH_MS, async () => {
        const body = await this.get<{ Messages?: { message?: string; messageLanguage?: string }[] }>(`${route}/BorderQueue/NotificationsSection/Fa`);
        // برچسب زبان قابل اعتماد نیست (متن ترکی هم «Fa» دارد)
        return (body.Messages ?? [])
          .filter((message) => /[\u0600-\u06FF]/.test(message.message ?? ''))
          .map((message) => text(message.message).replace(/\s*\n\s*/g, '\n'));
      }).catch(() => ({ data: [] as string[], stale: false })),
      this.cached('tirparks', border.id, TIRPARKS_FRESH_MS, async () => {
        const body = await this.get<{ Tirparks?: Record<string, unknown>[] }>(`${route}/BorderQueue/TirparkList/Fa`);
        return (body.Tirparks ?? []).map((tirpark) => this.tirpark(tirpark)).filter((tirpark) => tirpark.lat && tirpark.lng);
      }).catch(() => ({ data: [] as Tirpark[], stale: false })),
    ]);

    const queues = status.data.queues.filter((queue) => queue.inQueue || queue.called || queue.customsCheckedIn || queue.waitingCustoms);
    const sum = (field: 'inQueue' | 'called' | 'customsCheckedIn') => queues.reduce((total, queue) => total + queue[field], 0);
    return {
      border,
      lastUpdate: status.data.lastUpdate,
      totals: { inQueue: sum('inQueue'), called: sum('called'), customsCheckedIn: sum('customsCheckedIn') },
      queues: queues.sort((a, b) => b.inQueue - a.inQueue),
      notices: notices.data,
      tirparks: tirparks.data,
      stale: status.stale,
    };
  }

  /** وضعیت همه‌ی مرزها (برای فهرست با تعداد صف)؛ مرزی که جواب نداد کنار گذاشته می‌شود. */
  async details(): Promise<BorderDetail[]> {
    const borders = await this.borders();
    const details = await Promise.all(borders.map((border) => this.detail(border.id).catch(() => null)));
    return details.filter((detail): detail is BorderDetail => detail !== null);
  }

  /**
   * مرزهایی که اسم مرز یا کشورشان در متن آمده («بازرگان»، «مرزهای ترکیه»، «بیله سوار»)؛
   * خالی یعنی هیچ‌کدام (agent در آن صورت فهرست همه را نشان می‌دهد).
   */
  async find(query: string): Promise<BorderSummary[]> {
    const wanted = compact(query);
    if (!wanted) return [];
    const borders = await this.borders();
    const byName = borders.filter((border) => wanted.includes(compact(border.name)) || compact(border.name).includes(wanted));
    if (byName.length) return byName;
    return borders.filter((border) => wanted.includes(compact(border.country)) || compact(border.country).includes(wanted));
  }

  //#region ----------- borderpark --------------------------------------------

  private summary(border: Record<string, unknown>): BorderSummary {
    return {
      id: String(border.APIRouteAddress).replace(/-api$/, ''),
      name: text(border.BorderName),
      country: text(border.CountryName),
      countryCode: text(border.CountryCode),
      stats: {
        load: num(border.LastLoadTrCount),
        transit: num(border.LastTransitTrCount),
        export: num(border.LastExportTrCount),
        unload: num(border.LastUnLoadTrCount),
        customsCheckedIn: num(border.LastCustomCheckedIn),
      },
    };
  }

  private queue(queue: Record<string, unknown>): BorderQueue {
    return {
      title: text(queue.QueueTypeTitle_Fa || queue.QueueTypeTitle),
      inQueue: num(queue.TrailerInQueue),
      notPresent: num(queue.EQueueTrailerInQueue),
      empty: num(queue.EmptyTrailerInQueue),
      called: num(queue.CalledTrailer),
      customsCheckedIn: num(queue.CustomsCheckedIn),
      waitingCustoms: num(queue.ExitFromTirpark),
      waitHours: num(queue.CallWaitingHourCount),
    };
  }

  private tirpark(tirpark: Record<string, unknown>): Tirpark {
    const access = (tirpark.TirparkAccess as Record<string, unknown>[] | undefined) ?? [];
    return {
      name: text(tirpark.TirparkName),
      address: text(tirpark.TirparkAddress),
      capacity: num(tirpark.ParkCapacity),
      accepts: [...new Set(access.map((item) => text(item.QueueTypeTitle_Fa || item.QueueTypeTitle)).filter(Boolean))],
      lat: num(tirpark.TirParkLatitude),
      lng: num(tirpark.TirParkLongitude),
    };
  }

  protected async get<T>(path: string): Promise<T> {
    const { data } = await axios.get<T & { Error?: { ErrorCode?: number; ErrorText_En?: string } }>(`${this.baseUrl}${path}`, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (transport-backend border status)' },
    });
    if (data?.Error && data.Error.ErrorCode !== 0) throw new Error(`borderpark ${path}: ${data.Error.ErrorText_En ?? data.Error.ErrorCode}`);
    return data;
  }

  /** تازه از کش؛ کهنه یا نبود → borderpark؛ اگر نشد، داده‌ی کهنه با stale. */
  private async cached<T>(kind: string, border: string, freshMs: number, load: () => Promise<T>): Promise<{ data: T; stale: boolean }> {
    const key = RedisService.key('borderData', kind, border);
    const stored = await this.redis.getJson<Cached<T>>(key).catch(() => null);
    if (stored && Date.now() - stored.at < freshMs) return { data: stored.data, stale: false };

    let pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    try {
      const data = await pending;
      await this.redis.setJson<Cached<T>>(key, { at: Date.now(), data }, KEEP_SECONDS).catch(() => undefined);
      return { data, stale: false };
    } catch (error) {
      this.logger.warn(`Border ${kind} for ${border} failed: ${(error as Error).message}`);
      if (stored) return { data: stored.data, stale: true };
      throw error;
    }
  }

  //#endregion
}

// «بیله سوار» = «بیله‌سوار»، «آذربايجان» = «آذربایجان»
function compact(value: string): string {
  return normalizePersianText(value).replace(/[\s‌]/g, '');
}
