import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { COMPANY_FEATURE_TITLES, COMPANY_TIER_TITLES, CompanyFeature, CompanyTier, tierPeriodTitle } from 'src/domain/enums/companyFeature';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';

export type PaymentKind = 'SUBSCRIPTION' | 'FEATURE' | 'BROKER';
export type PaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PaymentView {
  id: string;
  kind: PaymentKind;
  title: string;
  /** the plan bought, when the title does not say it */
  detail: string | null;
  amount: string;
  currency: string;
  status: PaymentStatus;
  durationDays: number | null;
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
}

interface PaymentRow {
  id: string;
  kind: PaymentKind;
  planTitle: string | null;
  durationDays: number | null;
  amount: string;
  currency: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
  feature: CompanyFeature | null;
  tier: CompanyTier | null;
  features: CompanyFeature[] | null;
  brokerKind: 'NEW' | 'ADD' | 'PACKAGE' | 'SUGGESTION' | null;
  companies: number | null;
  requests?: number | null;
}

const LIMIT = 200;

/**
 * Everything an account paid for, newest first, whatever its role: a subscription (drivers, companies, factories,
 * brokers: bought in the app or in a messenger linked to it), a company's menu, a broker's companies' loads.
 * An order without a receipt (a messenger purchase left half-way, or cancelled) is no payment and is left out.
 */
@Injectable()
export class PaymentHistoryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(userId: string): Promise<PaymentView[]> {
    const rows: PaymentRow[] = await this.dataSource.query(
      `SELECT o.id, 'SUBSCRIPTION' AS kind, p.title AS "planTitle", p."durationDays", o.amount::text AS amount, o.currency,
              o.status::text AS status, o."createdAt", COALESCE(o."approvedAt", o."rejectedAt") AS "decidedAt", o."rejectionReason",
              NULL AS feature, NULL AS tier, NULL::varchar[] AS features, NULL AS "brokerKind", NULL::int AS companies, NULL::int AS requests
         FROM "SubscriptionOrder" o
         JOIN "SubscriptionPlan" p ON p.id = o."subscriptionPlanId"
        WHERE (o."createdUserId" = $1 OR o."providerUserId" IN (SELECT link."externalUserId" FROM "BotLink" link WHERE link."userId" = $1))
          AND o.status::text <> ALL($2::text[])
       UNION ALL
       SELECT o.id, 'FEATURE', p.title, o."durationDays", o.amount::text, o.currency, o.status, o."createdAt", o."reviewedAt",
              o."rejectionReason", o.feature, o.tier, o.features, NULL, NULL, NULL::int
         FROM "CompanyFeatureOrder" o
         LEFT JOIN "CompanyFeaturePlan" p ON p.id = o."planId"
        WHERE o."userId" = $1
       UNION ALL
       SELECT o.id, 'BROKER', NULL, o."durationDays", o.amount::text, o.currency, o.status, o."createdAt", o."reviewedAt",
              o."rejectionReason", NULL, NULL, NULL, o.kind, cardinality(o."companyUserIds"), o.requests
         FROM "BrokerAccessOrder" o
        WHERE o."userId" = $1
        ORDER BY "createdAt" DESC
        LIMIT ${LIMIT}`,
      [userId, [SubscriptionOrderStatus.WaitingForReceipt, SubscriptionOrderStatus.Cancelled]],
    );
    return rows.map((row) => paymentView(row));
  }
}

export function paymentView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    kind: row.kind,
    ...titleOf(row),
    amount: row.amount,
    currency: row.currency,
    status: statusOf(row.status),
    durationDays: row.durationDays === null ? null : Number(row.durationDays),
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    rejectionReason: row.rejectionReason,
  };
}

function titleOf(row: PaymentRow): { title: string; detail: string | null } {
  // a tier: its name, and the menus it opened under it
  if (row.kind === 'FEATURE' && row.tier) {
    const menus = (row.features ?? []).map((feature) => COMPANY_FEATURE_TITLES[feature] ?? feature).join('، ');
    return { title: `طرح ${COMPANY_TIER_TITLES[row.tier] ?? row.tier} ${tierPeriodTitle(Number(row.durationDays))}`, detail: menus || null };
  }
  if (row.kind === 'FEATURE') {
    return { title: `بخش «${(row.feature && COMPANY_FEATURE_TITLES[row.feature]) || row.planTitle || 'امکانات'}»`, detail: row.planTitle };
  }
  if (row.kind === 'BROKER' && row.brokerKind === 'SUGGESTION') {
    return { title: `بسته‌ی ${Number(row.requests ?? 0).toLocaleString('fa-IR')} معرفی راننده`, detail: null };
  }
  if (row.kind === 'BROKER' && row.brokerKind === 'PACKAGE') {
    return { title: `بسته‌ی ${Number(row.requests ?? 0).toLocaleString('fa-IR')} درخواست بار`, detail: null };
  }
  if (row.kind === 'BROKER') {
    const companies = Number(row.companies ?? 0).toLocaleString('fa-IR');
    return { title: `${row.brokerKind === 'ADD' ? 'افزودن' : 'خرید'} بار ${companies} شرکت حمل‌ونقل`, detail: null };
  }
  // a plan's title names it already («اشتراک ۱ ماهه»)
  const plan = row.planTitle?.trim();
  return { title: !plan ? 'اشتراک' : plan.startsWith('اشتراک') ? plan : `اشتراک ${plan}`, detail: null };
}

function statusOf(status: string): PaymentStatus {
  if (status === SubscriptionOrderStatus.Approved) return 'APPROVED';
  if (status === SubscriptionOrderStatus.Rejected) return 'REJECTED';
  return 'PENDING';
}
