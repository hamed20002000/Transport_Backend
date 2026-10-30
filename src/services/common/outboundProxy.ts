import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, type Dispatcher } from 'undici';

/**
 * سرویس‌هایی که از ایران فیلترند (تلگرام، واتساپ، OpenAI، اعلان گوشی) از OUTBOUND_PROXY_URL می‌روند: پراکسی HTTP که
 * ترافیکش از VPN بیرون می‌رود (wireproxy روی سرور)؛ بقیه (پیامک، نشان، بله، روبیکا، ایتا) مستقیم. اسم دامنه را خود
 * پراکسی از داخل تونل پیدا می‌کند، پس DNS آلوده‌ی شبکه جوابی برایشان نمی‌دهد. خالی: همه مستقیم (سیستمی که خودش VPN دارد).
 */
export const proxyUrl = (): string | null => process.env.OUTBOUND_PROXY_URL?.trim() || null;

let agent: { url: string; value: Agent } | undefined;
let dispatcher: { url: string; value: Dispatcher } | undefined;

/** For http/https clients (axios, node-telegram-bot-api, Baileys' socket and uploads); undefined: direct. */
export function outboundAgent(): Agent | undefined {
  const url = proxyUrl();
  if (!url) return undefined;
  if (agent?.url !== url) agent = { url, value: new HttpsProxyAgent(url, { keepAlive: true }) as unknown as Agent };
  return agent.value;
}

/** For Node's fetch (Baileys' media downloads); undefined: direct. */
export function outboundDispatcher(): Dispatcher | undefined {
  const url = proxyUrl();
  if (!url) return undefined;
  if (dispatcher?.url !== url) dispatcher = { url, value: new ProxyAgent(url) };
  return dispatcher.value;
}

/** axios options for a filtered service: through the proxy (axios' own env proxy off), or nothing extra. */
export function outboundAxios(): { httpsAgent?: Agent; httpAgent?: Agent; proxy?: false } {
  const value = outboundAgent();
  return value ? { httpsAgent: value, httpAgent: value, proxy: false } : {};
}
