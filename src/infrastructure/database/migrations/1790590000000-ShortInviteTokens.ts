import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * توکن دعوت‌ها ۱۶ حرف شد تا مسیر کوتاه لینک (d/…) در متغیر قالب sms.ir (حداکثر ۲۵ حرف) جا شود. دعوت‌هایی که هنوز
 * استفاده نشده‌اند همان ۱۶ حرف اول توکنشان را می‌گیرند (پیامکشان به همین دلیل نرفته بود)؛ دعوت استفاده‌شده دست
 * نمی‌خورد چون لینکش دیگر لازم نیست.
 */
export class ShortInviteTokens1790590000000 implements MigrationInterface {
  name = 'ShortInviteTokens1790590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['DriverInvite', 'FactoryInvite', 'CompanyInvite']) {
      await queryRunner.query(
        `UPDATE "${table}" SET token = left(token, 16) WHERE length(token) > 16 AND "usedAt" IS NULL AND "revokedAt" IS NULL`,
      );
    }
  }

  public async down(): Promise<void> {
    // the cut tokens are not kept: nothing to put back
  }
}
