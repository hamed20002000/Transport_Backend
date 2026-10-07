/** ابزارهای هندسی مسیر؛ مختصات به درجه و فاصله‌ها به کیلومتر. */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** فاصله‌ی خط مستقیم دو نقطه (haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** polyline گوگل (دقت ۵ رقم، خروجی OSRM و نشان) → نقطه‌ها. */
export function decodePolyline(encoded: string, precision = 5): GeoPoint[] {
  const factor = 10 ** precision;
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

/** فاصله‌ی تجمعی هر نقطه از ابتدای مسیر. */
export function cumulativeKm(points: GeoPoint[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) result.push(result[i - 1] + haversineKm(points[i - 1], points[i]));
  return result;
}

/** نقطه‌ی مسیر در کسری از طولش (۰ = مبدأ، ۱ = مقصد). */
export function pointAtFraction(points: GeoPoint[], fraction: number, cumulative = cumulativeKm(points)): GeoPoint {
  if (points.length === 0) throw new Error('Empty route.');
  const target = cumulative[cumulative.length - 1] * Math.min(1, Math.max(0, fraction));
  const i = cumulative.findIndex((km) => km >= target);
  if (i <= 0) return points[0];
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = (target - cumulative[i - 1]) / span;
  return {
    lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
    lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t,
  };
}

/** نقطه‌ها با فاصله‌ی حدوداً یکسان (برای سبک کردن محاسبه روی مسیرهای طولانی). */
export function resample(points: GeoPoint[], stepKm: number): { points: GeoPoint[]; km: number[] } {
  if (points.length < 2) return { points: [...points], km: points.map(() => 0) };
  const out = [points[0]];
  const km = [0];
  let total = 0;
  let sinceLast = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1], points[i]);
    total += d;
    sinceLast += d;
    if (sinceLast >= stepKm || i === points.length - 1) {
      out.push(points[i]);
      km.push(total);
      sinceLast = 0;
    }
  }
  return { points: out, km };
}

/**
 * نزدیک‌ترین فاصله‌ی نقطه تا مسیر و کیلومترِ مسیر در آن نقطه. تصویر روی
 * پاره‌خط‌ها با تقریب مسطح محلی (برای فاصله‌های چندکیلومتری دقیق کافی است).
 */
export function projectOnRoute(
  point: GeoPoint,
  route: GeoPoint[],
  routeKm: number[],
): { distanceKm: number; atKm: number } {
  let best = { distanceKm: Infinity, atKm: 0 };
  const kx = 111.32 * Math.cos(rad(point.lat));
  const ky = 110.57;
  for (let i = 1; i < route.length; i++) {
    const ax = (route[i - 1].lng - point.lng) * kx;
    const ay = (route[i - 1].lat - point.lat) * ky;
    const bx = (route[i].lng - point.lng) * kx;
    const by = (route[i].lat - point.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const distanceKm = Math.hypot(px, py);
    if (distanceKm < best.distanceKm) {
      best = { distanceKm, atKm: routeKm[i - 1] + (routeKm[i] - routeKm[i - 1]) * t };
    }
  }
  return best;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bboxOf(points: GeoPoint[], marginDeg = 0): BBox {
  return {
    south: Math.min(...points.map((p) => p.lat)) - marginDeg,
    west: Math.min(...points.map((p) => p.lng)) - marginDeg,
    north: Math.max(...points.map((p) => p.lat)) + marginDeg,
    east: Math.max(...points.map((p) => p.lng)) + marginDeg,
  };
}

export function inBBox(point: GeoPoint, box: BBox): boolean {
  return point.lat >= box.south && point.lat <= box.north && point.lng >= box.west && point.lng <= box.east;
}

/** حداکثر فاصله‌ی نقطه‌های مسیر a از مسیر b (برای تشخیص مسیرهای واقعاً متفاوت). */
export function maxDeviationKm(a: GeoPoint[], b: GeoPoint[]): number {
  const sampledA = resample(a, 10).points;
  const sampledB = resample(b, 2);
  return Math.max(0, ...sampledA.map((p) => projectOnRoute(p, sampledB.points, sampledB.km).distanceKm));
}

/** نقطه‌ها → polyline گوگل (دقت ۵ رقم)؛ عکس decodePolyline. */
export function encodePolyline(points: GeoPoint[], precision = 5): string {
  const factor = 10 ** precision;
  let output = '';
  let prevLat = 0;
  let prevLng = 0;
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * factor);
    const lng = Math.round(point.lng * factor);
    output += encode(lat - prevLat) + encode(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return output;
}

/**
 * مسیری که اجباراً از نقطه‌ای گذشته ممکن است برای رسیدن به آن وارد یک جاده‌ی
 * فرعی شود و از همان راه برگردد (رفت‌وبرگشت). این تکه حذف می‌شود: از نقطه‌ی
 * عبور به دو طرف جلو می‌رویم تا جایی که رفت و برگشت روی هم‌اند.
 */
export function trimSpur(points: GeoPoint[], atKm: number): { points: GeoPoint[]; removedKm: number } {
  const cumulative = cumulativeKm(points);
  const total = cumulative[cumulative.length - 1];
  const at = (km: number) => pointAtFraction(points, km / total, cumulative);
  let spur = 0;
  for (let d = 0.25; d <= Math.min(atKm, total - atKm, 60); d += 0.25) {
    if (haversineKm(at(atKm - d), at(atKm + d)) > 0.6) break;
    spur = d;
  }
  if (spur < 0.5) return { points, removedKm: 0 };
  const from = atKm - spur;
  const to = atKm + spur;
  const kept = [
    ...points.filter((_, i) => cumulative[i] <= from),
    at(from),
    ...points.filter((_, i) => cumulative[i] >= to),
  ];
  return { points: kept, removedKm: to - from };
}
