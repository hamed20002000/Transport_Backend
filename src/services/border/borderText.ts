import { BorderDetail, borderOrder, BorderQueue } from './borderStatus.service';

/** عدد فارسی با جداکننده‌ی هزارگان: ۸٬۳۹۴ */
export const faNumber = (value: number) => value.toLocaleString('fa-IR');

/** «۱۴۰۵-۰۷-۲۳ ۲۰:۳۸» → «۱۴۰۵/۰۷/۲۳ ساعت ۲۰:۳۸» */
function updatedAt(value: string | null): string {
  if (!value) return '';
  const [date, time] = value.split(' ');
  return `${date.replace(/-/g, '/')}${time ? ` ساعت ${time}` : ''}`.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

/** «۲۱ ساعت»؛ بیشتر از دو روز «حدود ۲۷ روز» (صف بازرگان گاهی صدها ساعت است) */
export function waitText(hours: number): string {
  return hours > 48 ? `حدود ${faNumber(Math.round(hours / 24))} روز` : `${faNumber(hours)} ساعت`;
}

/** بیشترین زمان انتظار صف‌های مرز (ساعت)؛ صف‌های خالی حساب نمی‌شوند. */
export function maxWaitHours(detail: BorderDetail): number {
  return Math.max(0, ...detail.queues.filter((queue) => queue.inQueue).map((queue) => queue.waitHours));
}

/** یک خط فهرست: «بازرگان (ترکیه): ۸٬۳۹۴ در صف · انتظار تا ۲۱ ساعت» */
export function borderLine(detail: BorderDetail): string {
  const wait = maxWaitHours(detail);
  return [
    `${detail.border.name} (${detail.border.country}): ${faNumber(detail.totals.inQueue)} در صف`,
    detail.totals.called ? `${faNumber(detail.totals.called)} فراخوان‌شده` : '',
    wait ? `انتظار تا ${waitText(wait)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** فهرست مرزها (ترتیب borderOrder)؛ شلوغی هر مرز با تعداد صف. */
export function bordersText(details: BorderDetail[]): string {
  if (!details.length) return 'وضعیت مرزها الان در دسترس نیست؛ کمی بعد دوباره امتحان کنید.';
  const sorted = [...details].sort(borderOrder);
  const latest = details.map((detail) => detail.lastUpdate).filter((value): value is string => !!value).sort().pop() ?? null;
  return [
    '🛃 وضعیت صف کامیون‌ها در مرزهای زمینی',
    sorted.map((detail) => `• ${borderLine(detail)}`).join('\n'),
    latest ? `🕓 آخرین به‌روزرسانی: ${updatedAt(latest)}` : '',
    details.some((detail) => detail.stale) ? '⚠️ بعضی مرزها الان جواب نمی‌دهند؛ آخرین وضعیت ذخیره‌شده‌شان نشان داده شده.' : '',
    'منبع: borderpark.ir',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function queueLine(queue: BorderQueue): string {
  const parts = [
    `${faNumber(queue.inQueue)} در صف${queue.notPresent ? ` (${faNumber(queue.notPresent)} هنوز در مرز نیستند)` : ''}${queue.empty ? ` (${faNumber(queue.empty)} خالی)` : ''}`,
    queue.called ? `${faNumber(queue.called)} فراخوان‌شده` : '',
    queue.waitingCustoms ? `${faNumber(queue.waitingCustoms)} در انتظار ورود به گمرک` : '',
    queue.customsCheckedIn ? `${faNumber(queue.customsCheckedIn)} پذیرش گمرک` : '',
    queue.waitHours ? `انتظار ${waitText(queue.waitHours)}` : '',
  ];
  return `▫️ ${queue.title}\n   ${parts.filter(Boolean).join(' · ')}`;
}

// پیام پیام‌رسان‌ها محدود است (تلگرام ۴۰۹۶ حرف) و دوغارون بیش از ۲۰ نوع صف دارد
const MAX_QUEUES = 10;

function queuesText(queues: BorderQueue[]): string {
  const shown = queues.slice(0, MAX_QUEUES).map(queueLine);
  if (queues.length > MAX_QUEUES) {
    const rest = queues.slice(MAX_QUEUES).reduce((total, queue) => total + queue.inQueue, 0);
    shown.push(`… و ${faNumber(queues.length - MAX_QUEUES)} صف دیگر (${faNumber(rest)} در صف)`);
  }
  return shown.join('\n');
}

/** جزئیات یک مرز: صف‌ها، اطلاعیه‌ها، آمار اخیر و تیرپارک‌ها. */
export function borderDetailText(detail: BorderDetail): string {
  const { border, totals, stats } = { ...detail, stats: detail.border.stats };
  const statParts = [
    stats.export ? `صادرات ${faNumber(stats.export)}` : '',
    stats.transit ? `ترانزیت ${faNumber(stats.transit)}` : '',
    stats.unload ? `تخلیه ${faNumber(stats.unload)}` : '',
    stats.load ? `بارگیری ${faNumber(stats.load)}` : '',
    stats.customsCheckedIn ? `پذیرش گمرک ${faNumber(stats.customsCheckedIn)}` : '',
  ].filter(Boolean);
  return [
    `🛃 مرز ${border.name} (${border.country})`,
    `🚛 کل صف: ${faNumber(totals.inQueue)} · فراخوان‌شده: ${faNumber(totals.called)}${maxWaitHours(detail) ? ` · انتظار تا ${waitText(maxWaitHours(detail))}` : ''}`,
    detail.queues.length ? queuesText(detail.queues) : 'الان صفی در این مرز ثبت نشده.',
    ...detail.notices.map((notice) => `📢 اطلاعیه‌ی مرز:\n${notice}`),
    statParts.length ? `📊 آمار اخیر مرز: ${statParts.join(' · ')}` : '',
    detail.tirparks.length
      ? `🅿️ تیرپارک‌ها:\n${detail.tirparks
          .map((tirpark) => `• ${tirpark.name}${tirpark.capacity ? ` (ظرفیت ${faNumber(tirpark.capacity)})` : ''}${tirpark.address ? ` — ${tirpark.address}` : ''}${tirpark.accepts.length ? `\n   پذیرش: ${tirpark.accepts.join('، ')}` : ''}`)
          .join('\n')}`
      : '',
    detail.lastUpdate ? `🕓 آخرین به‌روزرسانی: ${updatedAt(detail.lastUpdate)}` : '',
    detail.stale ? '⚠️ borderpark الان جواب نمی‌دهد؛ این آخرین وضعیت ذخیره‌شده است.' : '',
    'منبع: borderpark.ir',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** لینک مسیریابی تا تیرپارک */
export const tirparkMapUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lng.toFixed(5)}&travelmode=driving`;
