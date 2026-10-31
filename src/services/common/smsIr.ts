import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * SMS through sms.ir, instead of Melipayamak when SMS_PROVIDER=smsir. With a template id (SMSIR_OTP_TEMPLATE_ID,
 * SMSIR_INVITE_TEMPLATE_ID: «ارسال سریع», POST /v1/send/verify) the text is the approved template and reaches numbers
 * on the advertising blacklist too; without one, a plain SMS (POST /v1/send/bulk) from SMSIR_LINE_NUMBER (when empty,
 * the account's first line from /v1/line), which an advertising line can't deliver to blacklisted numbers.
 * Settings: SMSIR_API_KEY. sms.ir is inside Iran: it goes direct, never through the VPN proxy.
 */
const API = 'https://api.sms.ir/v1';

export type SmsIrResult = { ok: true } | { ok: false; reason: string; notConfigured?: boolean };

export function smsIrSelected(config: ConfigService): boolean {
  return config.get<string>('SMS_PROVIDER')?.trim().toLowerCase() === 'smsir';
}

/** the account's line, asked once when SMSIR_LINE_NUMBER is not set */
let accountLine: Promise<number | null> | null = null;

async function lineNumber(http: HttpService, config: ConfigService, key: string): Promise<number | null> {
  const configured = config.get<string>('SMSIR_LINE_NUMBER')?.trim();
  if (configured && /^\d{4,20}$/.test(configured)) return Number(configured);
  accountLine ??= firstValueFrom(
    http.get<{ status?: number; data?: unknown[] }>(`${API}/line`, { headers: headers(key), timeout: 10000 }),
  ).then(
    (response) => {
      const first = response.data?.data?.[0];
      const line = Number(typeof first === 'object' && first ? (first as { lineNumber?: unknown }).lineNumber : first);
      return line > 0 ? line : null;
    },
    () => null,
  );
  const line = await accountLine;
  if (!line) accountLine = null; // ask again next time
  return line;
}

function headers(key: string) {
  return { 'X-API-KEY': key, 'Content-Type': 'application/json', Accept: 'application/json' };
}

/** the template id in setting, or null when not set */
export function smsIrTemplate(config: ConfigService, setting: string): number | null {
  const id = Number(config.get<string>(setting)?.trim());
  return id > 0 ? id : null;
}

/** «ارسال سریع»: the approved template templateId with its variables (#NAME# in the template ← parameters.NAME). */
export async function sendSmsIrVerify(
  http: HttpService,
  config: ConfigService,
  to: string,
  templateId: number,
  parameters: Record<string, string>,
): Promise<SmsIrResult> {
  const key = config.get<string>('SMSIR_API_KEY')?.trim();
  if (!key) return { ok: false, reason: 'SMSIR_API_KEY is not set', notConfigured: true };
  const body = { mobile: to, templateId, parameters: Object.entries(parameters).map(([name, value]) => ({ name, value })) };
  return post(http, `${API}/send/verify`, body, key);
}

export async function sendSmsIr(http: HttpService, config: ConfigService, to: string, text: string): Promise<SmsIrResult> {
  const key = config.get<string>('SMSIR_API_KEY')?.trim();
  if (!key) return { ok: false, reason: 'SMSIR_API_KEY is not set', notConfigured: true };
  const line = await lineNumber(http, config, key);
  if (!line) return { ok: false, reason: 'no sms.ir line: set SMSIR_LINE_NUMBER', notConfigured: true };
  return post(http, `${API}/send/bulk`, { lineNumber: line, messageText: text, mobiles: [to] }, key);
}

async function post(http: HttpService, url: string, body: object, key: string): Promise<SmsIrResult> {
  try {
    const response = await firstValueFrom(
      http.post<{ status?: number; message?: string }>(url, body, { headers: headers(key), timeout: 15000, maxRedirects: 0 }),
    );
    if (response.data?.status !== 1) return { ok: false, reason: String(response.data?.message ?? 'rejected') };
    return { ok: true };
  } catch (error) {
    // the key is in a header, not in the message: still, log only the provider's answer
    const failure = (error as { response?: { status?: number; data?: { status?: unknown; message?: unknown } } })?.response;
    return {
      ok: false,
      reason: `HTTP ${failure?.status ?? 'n/a'}: ${String(failure?.data?.message ?? (error as Error).message)}`,
    };
  }
}
