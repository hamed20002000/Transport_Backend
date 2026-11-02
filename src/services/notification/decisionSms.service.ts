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
 * messengers and the open page all need it. Only the result goes; the reason of a rejection is read in the app.
 *
 * sms.ir «ارسال سریع» template SMSIR_NOTICE_TEMPLATE_ID with #TITLE# (what was decided, 25 characters at most) and
 * #RESULT# («تأیید شد» / «تأیید نشد»), so it reaches numbers on the advertising blacklist too; without it, a plain SMS.
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

  async send(userId: string, title: string, approved: boolean): Promise<void> {
    const rows: Array<{ mobile: string | null }> = await this.dataSource.query(`SELECT mobile FROM "User" WHERE id = $1`, [userId]);
    const mobile = rows[0]?.mobile?.trim();
    if (!mobile || !/^09[0-9]{9}$/.test(mobile)) return;
    const result = approved ? 'تأیید شد' : 'تأیید نشد';
    const panel = this.config.get<string>('WEB_PANEL_URL')?.trim().replace(/\/+$/, '');
    const text = ['ترابوت', `${title}: ${result}`, approved ? '' : 'دلیل را در برنامه ببینید.', panel].filter(Boolean).join('\n');

    if (this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() !== 'true') {
      this.logger.log(`Decision SMS is off; would send to ${mobile}: ${text.replace(/\n/g, ' | ')}`);
      return;
    }
    if (!smsIrSelected(this.config)) {
      this.logger.warn('Decision SMS not sent: only sms.ir (SMS_PROVIDER=smsir) sends it.');
      return;
    }
    const templateId = smsIrTemplate(this.config, 'SMSIR_NOTICE_TEMPLATE_ID');
    const sent = templateId
      ? await sendSmsIrVerify(this.http, this.config, mobile, templateId, { TITLE: fitTemplateValue(title), RESULT: result })
      : await sendSmsIr(this.http, this.config, mobile, text);
    if (!sent.ok) this.logger[sent.notConfigured ? 'warn' : 'error'](`Decision SMS to ${mobile} not sent: ${sent.reason}`);
  }
}
