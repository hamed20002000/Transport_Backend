import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { sendSmsIr, sendSmsIrVerify, smsIrSelected, smsIrTemplate } from '../common/smsIr';
import { fitTemplateValue } from '../company/inviteSms.service';

/**
 * The answer to what a user waited for (a payment receipt: subscription, tier or menu, a broker's companies; the check
 * of its account) also by SMS: the user may be where there is no internet when the answer comes, and the push, the
 * messengers and the open page all need it. Only that it was decided goes, not how: the result and the reason of a
 * rejection are read in the panel.
 *
 * sms.ir «ارسال سریع» template SMSIR_NOTICE_TEMPLATE_ID with #TITLE# alone (what was decided, 25 characters at most):
 *   ترابوت
 *   نتیجه‌ی «#TITLE#» مشخص شده است و می‌توانید آن را از طریق پنل کاربری مشاهده و بررسی نمایید.
 *   https://tarabots.com
 * so it reaches numbers on the advertising blacklist too; without it, the same as a plain SMS.
 * And a company's bought menus closing in a few days (CompanyPlanExpiryWorker): template SMSIR_PLAN_REMINDER_TEMPLATE_ID
 * with #TITLE# («طرح طلایی») and #DAYS#.
 * Off like every SMS while SMS_OTP_ENABLED is not true (development): only logged.
 */
@Injectable()
export class DecisionSmsService {
  private readonly logger = new Logger(DecisionSmsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async send(userId: string, title: string): Promise<void> {
    await this.deliver(userId, 'SMSIR_NOTICE_TEMPLATE_ID', { TITLE: title }, (panel) =>
      ['ترابوت', `نتیجه‌ی «${title}» مشخص شده است و می‌توانید آن را از طریق پنل کاربری مشاهده و بررسی نمایید.`, panel]);
  }

  /** title: «طرح طلایی» (or «بخش‌های خریده‌شده»); days left until it closes. */
  async sendPlanReminder(userId: string, title: string, days: number): Promise<void> {
    const left = days.toLocaleString('fa-IR');
    await this.deliver(userId, 'SMSIR_PLAN_REMINDER_TEMPLATE_ID', { TITLE: title, DAYS: left }, (panel) =>
      ['ترابوت', `${title} شما ${left} روز دیگر تمام می‌شود.`, 'برای تمدید به خرید امکانات بروید:', panel]);
  }

  /** The user's mobile, the template of setting with its values, or (no template) the plain text lines. */
  private async deliver(userId: string, setting: string, values: Record<string, string>, lines: (panel?: string) => Array<string | undefined>) {
    const rows: Array<{ mobile: string | null }> = await this.dataSource.query(`SELECT mobile FROM "User" WHERE id = $1`, [userId]);
    const mobile = rows[0]?.mobile?.trim();
    if (!mobile || !/^09[0-9]{9}$/.test(mobile)) return;
    const panel = this.config.get<string>('WEB_PANEL_URL')?.trim().replace(/\/+$/, '');
    const text = lines(panel).filter(Boolean).join('\n');

    if (this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() !== 'true') {
      this.logger.log(`Notice SMS is off; would send to ${mobile}: ${text.replace(/\n/g, ' | ')}`);
      return;
    }
    if (!smsIrSelected(this.config)) {
      this.logger.warn('Notice SMS not sent: only sms.ir (SMS_PROVIDER=smsir) sends it.');
      return;
    }
    const templateId = smsIrTemplate(this.config, setting);
    const parameters = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, fitTemplateValue(value)]));
    const sent = templateId
      ? await sendSmsIrVerify(this.http, this.config, mobile, templateId, parameters)
      : await sendSmsIr(this.http, this.config, mobile, text);
    if (!sent.ok) this.logger[sent.notConfigured ? 'warn' : 'error'](`Notice SMS to ${mobile} not sent: ${sent.reason}`);
  }
}
