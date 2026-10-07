import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import sharp from 'sharp';

import { GeoPoint } from './geo';
import { ipv4Agent } from './http';

const TILE = 256;
const MIN_ZOOM = 4;
const MAX_ZOOM = 16;
const PADDING = 48;
const TILE_CACHE_MS = 30 * 86_400_000;
const TILE_TIMEOUT_MS = 15_000;
const TILE_CONCURRENCY = 6;

export type MapMarkerKind = 'origin' | 'destination' | 'driver' | 'gasoline' | 'diesel' | 'cng';

export interface MapMarker {
  point: GeoPoint;
  kind: MapMarkerKind;
  // عدد روی نشانگر (همان شماره‌ی فهرست متن)؛ بدون آن نقطه‌ی کوچک
  label?: string;
}

export interface MapLine {
  points: GeoPoint[];
  // مسیر اصلی پررنگ، بقیه کم‌رنگ‌تر
  primary?: boolean;
  color?: string;
  // شماره‌ی مسیر وسط خط («۱»، «۲»… در فهرست مسیرها)
  label?: string;
}

export const MARKER_COLORS: Record<MapMarkerKind, string> = {
  origin: '#2e7d32',
  destination: '#c62828',
  // هر رنگ با یک ایموجی در راهنمای زیرنویس: 🟢 مبدأ 🔴 مقصد 🟣 شما 🟠 بنزین ⚫ گازوئیل 🔵 CNG
  driver: '#7b1fa2',
  gasoline: '#ef6c00',
  diesel: '#212121',
  cng: '#1565c0',
};

export const ROUTE_COLORS = ['#1e88e5', '#8e24aa', '#00897b'];

/**
 * تصویر نقشه (JPEG) با کاشی‌های OpenStreetMap و خط مسیر و نشانگرها، برای
 * فرستادن به‌صورت عکس در ربات‌ها و واتساپ (که نقشه‌ی تعاملی با چند نقطه ندارند).
 * کاشی‌ها روی دیسک کش می‌شوند. روی تصویر فقط عدد لاتین است تا به فونت
 * فارسیِ سرور وابسته نباشد؛ راهنمای رنگ‌ها در زیرنویس فارسی عکس می‌آید.
 */
@Injectable()
export class StaticMapService {
  private readonly logger = new Logger(StaticMapService.name);
  private readonly tileUrl: string;
  private readonly userAgent: string;
  private readonly cacheDir = join(tmpdir(), 'transport-map-tiles');

  constructor(config: ConfigService) {
    this.tileUrl = config.get<string>('MAP_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    this.userAgent = config.get<string>('ROUTING_USER_AGENT', 'TransportBot/1.0');
  }

  async render(options: { lines?: MapLine[]; markers?: MapMarker[]; width?: number; height?: number }): Promise<Buffer> {
    const width = options.width ?? 1024;
    const height = options.height ?? 768;
    const lines = options.lines ?? [];
    const markers = options.markers ?? [];
    const all = [...lines.flatMap((line) => line.points), ...markers.map((marker) => marker.point)];
    if (!all.length) throw new Error('Nothing to draw.');

    const zoom = this.fitZoom(all, width, height);
    const pixels = all.map((point) => worldPixel(point, zoom));
    const centerX = (Math.min(...pixels.map((p) => p.x)) + Math.max(...pixels.map((p) => p.x))) / 2;
    const centerY = (Math.min(...pixels.map((p) => p.y)) + Math.max(...pixels.map((p) => p.y))) / 2;
    const left = Math.round(centerX - width / 2);
    const top = Math.round(centerY - height / 2);

    const base = await this.basemap(zoom, left, top, width, height);
    const overlay = Buffer.from(this.svg({ lines, markers, zoom, left, top, width, height }));
    return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer();
  }

  /** بزرگ‌ترین بزرگنمایی که همه‌چیز (با حاشیه) در تصویر جا شود. */
  private fitZoom(points: GeoPoint[], width: number, height: number): number {
    for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
      const pixels = points.map((point) => worldPixel(point, zoom));
      const spanX = Math.max(...pixels.map((p) => p.x)) - Math.min(...pixels.map((p) => p.x));
      const spanY = Math.max(...pixels.map((p) => p.y)) - Math.min(...pixels.map((p) => p.y));
      if (spanX <= width - 2 * PADDING && spanY <= height - 2 * PADDING) return zoom;
    }
    return MIN_ZOOM;
  }

  /** کاشی‌های پوشاننده‌ی تصویر، کنار هم و بریده به اندازه‌ی تصویر. */
  private async basemap(zoom: number, left: number, top: number, width: number, height: number): Promise<Buffer> {
    const x0 = Math.floor(left / TILE);
    const y0 = Math.floor(top / TILE);
    const x1 = Math.floor((left + width - 1) / TILE);
    const y1 = Math.floor((top + height - 1) / TILE);
    const count = 2 ** zoom;

    const jobs: { x: number; y: number }[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push({ x, y });
    const tiles: { input: Buffer; left: number; top: number }[] = [];
    for (let i = 0; i < jobs.length; i += TILE_CONCURRENCY) {
      const batch = await Promise.all(
        jobs.slice(i, i + TILE_CONCURRENCY).map(async ({ x, y }) => {
          if (y < 0 || y >= count) return null;
          const tile = await this.tile(zoom, ((x % count) + count) % count, y);
          return tile ? { input: tile, left: (x - x0) * TILE, top: (y - y0) * TILE } : null;
        }),
      );
      tiles.push(...batch.filter((tile): tile is { input: Buffer; left: number; top: number } => !!tile));
    }

    const canvas = await sharp({
      create: { width: (x1 - x0 + 1) * TILE, height: (y1 - y0 + 1) * TILE, channels: 3, background: '#e8e4dc' },
    })
      .composite(tiles)
      .png()
      .toBuffer();
    return sharp(canvas)
      .extract({ left: left - x0 * TILE, top: top - y0 * TILE, width, height })
      .png()
      .toBuffer();
  }

  /** یک کاشی از کش دیسک یا سرور نقشه؛ کاشیِ نرسیده جایش خاکستری می‌ماند. */
  private async tile(z: number, x: number, y: number): Promise<Buffer | null> {
    const file = join(this.cacheDir, String(z), String(x), `${y}.png`);
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs < TILE_CACHE_MS) return await fs.readFile(file);
    } catch {
      // در کش نیست
    }
    try {
      const url = this.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      const { data } = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: TILE_TIMEOUT_MS,
        httpsAgent: ipv4Agent,
        headers: { 'User-Agent': this.userAgent },
      });
      const buffer = Buffer.from(data);
      await fs.mkdir(dirname(file), { recursive: true });
      await fs.writeFile(file, buffer);
      return buffer;
    } catch (error) {
      this.logger.warn(`Map tile ${z}/${x}/${y} failed: ${(error as Error).message}`);
      return null;
    }
  }

  private svg(options: {
    lines: MapLine[];
    markers: MapMarker[];
    zoom: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }): string {
    const { zoom, left, top, width, height } = options;
    const at = (point: GeoPoint) => {
      const p = worldPixel(point, zoom);
      return { x: p.x - left, y: p.y - top };
    };
    const parts: string[] = [];

    // رنگ هر مسیر از جایش در فهرست (مسیر ۱ آبی…)؛ بعد اول فرعی‌ها و اصلی روی همه
    const ordered = options.lines
      .map((line, i) => ({ ...line, color: line.color ?? ROUTE_COLORS[i % ROUTE_COLORS.length] }))
      .sort((a, b) => Number(!!a.primary) - Number(!!b.primary));
    for (const line of ordered) {
      const color = line.color;
      const path = simplifiedPath(line.points.map(at));
      if (!path) continue;
      const w = line.primary ? 6 : 4;
      parts.push(
        `<path d="${path}" fill="none" stroke="#ffffff" stroke-width="${w + 4}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`,
        `<path d="${path}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" opacity="${line.primary ? 1 : 0.75}"/>`,
      );
    }
    for (const line of ordered) {
      if (!line.label || line.points.length < 2) continue;
      const color = line.color;
      const mid = at(line.points[Math.floor(line.points.length / 2)]);
      parts.push(badge(mid.x, mid.y, 14, color, line.label, 15));
    }

    // نشانگرها: نقطه‌های بی‌شماره زیر، شماره‌دارها و مبدأ/مقصد/راننده رو
    const rank = (marker: MapMarker) => (marker.label ? 2 : ['origin', 'destination', 'driver'].includes(marker.kind) ? 3 : 1);
    for (const marker of [...options.markers].sort((a, b) => rank(a) - rank(b))) {
      const { x, y } = at(marker.point);
      const color = MARKER_COLORS[marker.kind];
      if (marker.kind === 'origin' || marker.kind === 'destination') {
        parts.push(
          `<circle cx="${x}" cy="${y}" r="13" fill="${color}" stroke="#ffffff" stroke-width="3"/>`,
          `<circle cx="${x}" cy="${y}" r="5" fill="#ffffff"/>`,
        );
      } else if (marker.kind === 'driver') {
        parts.push(
          `<circle cx="${x}" cy="${y}" r="22" fill="${color}" opacity="0.2"/>`,
          `<circle cx="${x}" cy="${y}" r="10" fill="${color}" stroke="#ffffff" stroke-width="3"/>`,
        );
      } else if (marker.label) {
        parts.push(badge(x, y, 11, color, marker.label, marker.label.length > 2 ? 10 : 12));
      } else {
        parts.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`);
      }
    }

    // ذکر منبع (شرط استفاده از داده‌ی OpenStreetMap)
    parts.push(
      `<rect x="${width - 196}" y="${height - 20}" width="196" height="20" fill="#ffffff" opacity="0.8"/>`,
      `<text x="${width - 6}" y="${height - 6}" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#333333" text-anchor="end">© OpenStreetMap contributors</text>`,
    );
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`;
  }
}

/** مختصات پیکسلی Web Mercator در یک بزرگنمایی. */
export function worldPixel(point: GeoPoint, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const lat = Math.max(-85.05, Math.min(85.05, point.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** مسیر SVG با حذف نقطه‌های کمتر از ۲ پیکسل از قبلی (مسیرهای هزارنقطه‌ای). */
function simplifiedPath(points: { x: number; y: number }[]): string {
  const kept: { x: number; y: number }[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2) kept.push(point);
  }
  if (kept.length < 2) return '';
  return kept.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
}

function badge(x: number, y: number, r: number, color: string, label: string, fontSize: number): string {
  const text = label.replace(/[^0-9A-Za-z+]/g, '');
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
    `<text x="${x}" y="${y + fontSize * 0.36}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff" text-anchor="middle">${text}</text>`
  );
}
