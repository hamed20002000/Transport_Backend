const DATE_TIME = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const TIME = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** «۱۴۰۵/۰۷/۱۵ ساعت ۱۴:۳۲» به وقت تهران */
export function persianDateTime(date: Date | string): string {
  return DATE_TIME.format(new Date(date)).replace(/[,،]\s*/, ' ساعت ');
}

/** «۱۴:۳۲» به وقت تهران */
export function persianTime(date: Date | string): string {
  return TIME.format(new Date(date));
}
