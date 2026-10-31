import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Plain SMS (no template) through sms.ir: POST /v1/send/bulk from our line. Used instead of Melipayamak when
 * SMS_PROVIDER=smsir. Settings: SMSIR_API_KEY, SMSIR_LINE_NUMBER (when empty, the account's first line from /v1/line).
 * sms.ir is inside Iran: it goes direct, never through the VPN proxy.
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

export async function sendSmsIr(http: HttpService, config: ConfigService, to: string, text: string): Promise<SmsIrResult> {
  const key = config.get<string>('SMSIR_API_KEY')?.trim();
  if (!key) return { ok: false, reason: 'SMSIR_API_KEY is not set', notConfigured: true };
  const line = await lineNumber(http, config, key);
  if (!line) return { ok: false, reason: 'no sms.ir line: set SMSIR_LINE_NUMBER', notConfigured: true };
  try {
    const response = await firstValueFrom(
      http.post<{ status?: number; message?: string }>(
        `${API}/send/bulk`,
        { lineNumber: line, messageText: text, mobiles: [to] },
        { headers: headers(key), timeout: 15000, maxRedirects: 0 },
      ),
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
