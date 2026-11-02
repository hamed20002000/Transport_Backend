// what CompanyPlanExpiryWorker tells a company, and its text (SubscriptionNotifier sends it); apart from both, so
// neither imports the other

const fa = (value: number) => value.toLocaleString('fa-IR');
const faDate = (value: Date) => value.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });

export interface PlanExpiringNotice {
  userId: string;
  /** «طرح نقره‌ای», or null when the menus were bought (or given) one by one */
  tierTitle: string | null;
  features: string[];
  endsAt: Date;
  daysLeft: number;
}

export const planExpiringText = (notice: PlanExpiringNotice) =>
  [
    notice.tierTitle
      ? `⏳ ${notice.tierTitle} شما ${faDate(notice.endsAt)} (${fa(notice.daysLeft)} روز دیگر) تمام می‌شود.`
      : `⏳ مدت بخش‌های خریده‌شده‌ی شما ${faDate(notice.endsAt)} (${fa(notice.daysLeft)} روز دیگر) تمام می‌شود.`,
    `این بخش‌ها بسته می‌شوند: ${notice.features.join('، ')}`,
    'برای تمدید یا خرید طرح دیگر به «💎 خرید امکانات» بروید؛ مدت تازه بعد از پایان مدت فعلی شروع می‌شود و روزی از دست نمی‌رود.',
  ].join('\n');
