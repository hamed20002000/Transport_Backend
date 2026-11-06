import { Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { outboundAxios } from './outboundProxy';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * تنها جایی که مدل زبانی (chat، vision) و embedding صدا زده می‌شوند؛ سرویس‌ها فقط
 * پیام، schema خروجی و تنظیمات خودشان را می‌دهند. آدرس و نام مدل از env می‌آیند:
 *   OLLAMA_URL       پایه‌ی سرور (پیش‌فرض http://localhost:11434)
 *   LLM_MODEL        مدل متنی (پیش‌فرض qwen3:8b)
 *   EMBEDDING_MODEL  مدل embedding (پیش‌فرض bge-m3:latest)
 * env موقع فراخوانی خوانده می‌شود نه موقع import: ConfigModule فایل .env را بعد از
 * import شدن سرویس‌ها بار می‌کند.
 *
 * OpenAI (اختیاری): با OPENAI_API_KEY و OPENAI_MODEL، پرامپت‌های متنی اول به OpenAI
 * می‌روند و اگر جواب نداد همان پرامپت به مدل محلی می‌رود. بعد از قطعی (شبکه، تایم‌اوت،
 * 5xx، 429، کلید نامعتبر) تا OPENAI_RETRY_AFTER_MS مستقیم محلی، بعد دوباره امتحان.
 *   OPENAI_MODEL_LIGHT مدل ارزان‌تر برای درخواست‌های tier: 'light' (پیش‌فرض همان OPENAI_MODEL)
 *   OPENAI_BASE_URL    پیش‌فرض https://api.openai.com/v1 (برای relay/پراکسی)
 *   OPENAI_TIMEOUT_MS  پیش‌فرض 15000؛ اگر درخواست timeoutMs کمتری دارد همان
 *   OPENAI_STT_MODEL   مدل ویس به متن (بدون آن ویس محلی با whisper.cpp)
 *   OPENAI_VISION_MODEL مدل درخواست‌های تصویردار (رسید پرداخت)؛ پیش‌فرض همان OPENAI_MODEL
 *   OPENAI_EMBEDDING_MODEL مدل embedding (پیش‌فرض text-embedding-3-large؛ small در ارزیابی domainها ۷۸٪ در برابر ۸۴٪) با EMBEDDING_DIMENSIONS بُعد
 *     (پیش‌فرض 1024، اندازه‌ی ستون vector جدول‌های ToolDomain و EmbeddingTool)
 *   LLM_LOCAL_FALLBACK=off  مدل محلی جایگزین نمی‌شود؛ قطعی OpenAI یعنی LlmUnavailableError
 * embedding هیچ‌وقت به مدل محلی نمی‌رود: بردارهای دو مدل با هم قابل مقایسه نیستند؛ با عوض شدن
 * مدل embedding، بردارهای ذخیره‌شده با npm run agent:seed از نو ساخته می‌شوند.
 */

const logger = new Logger('LlmClient');

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** تصویرهای base64 برای مدل vision */
  images?: string[];
}

export interface LlmChatRequest {
  messages: LlmMessage[];
  /** JSON schema خروجی؛ بدون آن متن آزاد برمی‌گردد */
  format?: Record<string, unknown>;
  think?: boolean;
  options?: Record<string, unknown>;
  /** مدل محلی وقتی جز LLM_MODEL لازم است (مثلاً vision)؛ فقط برای جایگزینی محلی */
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** light: کار ساده‌تر با مدل ارزان‌تر OpenAI (OPENAI_MODEL_LIGHT)؛ پیش‌فرض strong */
  tier?: 'light' | 'strong';
}

/** هیچ مدلی برای جواب دادن در دسترس نیست؛ message برای نمایش به کاربر است. */
export class LlmUnavailableError extends Error {
  constructor() {
    super('در حال حاضر انجام این عملیات ممکن نیست؛ لطفاً کمی بعد دوباره تلاش کنید.');
    this.name = 'LlmUnavailableError';
  }
}

const localFallback = (): boolean => process.env.LLM_LOCAL_FALLBACK !== 'off';

export const llmModel = (): string => process.env.LLM_MODEL || 'qwen3:8b';

export const embeddingModel = (): string => process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';

// OLLAMA_URL قبلاً جایی آدرس پایه و جایی آدرس کامل /api/chat خوانده می‌شد؛ هر دو پذیرفته می‌شوند
function ollamaBase(): string {
  return (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '').replace(/\/api\/chat$/, '');
}

// تا این لحظه (epoch ms) OpenAI امتحان نمی‌شود -- مشترک بین پرامپت و ویس
let openAiDownUntil = 0;

interface OpenAiConfig {
  key: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  retryAfterMs: number;
}

/** null یعنی OpenAI برای این کار تنظیم نشده (کلید یا مدلش نیست). */
function openAiConfig(model: string | undefined, timeoutMs: number): OpenAiConfig | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !model) return null;
  return {
    key,
    model,
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    timeoutMs,
    retryAfterMs: Number(process.env.OPENAI_RETRY_AFTER_MS) || 60_000,
  };
}

const isCancel = (error: unknown) => axios.isCancel(error) || (error as Error)?.name === 'AbortError';

// قطعی یا مشکل حساب (نه ایراد همین یک درخواست) -- تا مدتی سراغ OpenAI نمی‌رویم
function isOutage(error: unknown): boolean {
  const status = (error as AxiosError)?.response?.status;
  return status === undefined || status >= 500 || [401, 403, 404, 408, 429].includes(status);
}

/**
 * اول OpenAI؛ اگر تنظیم نیست یا جواب نداد، local -- یا با LLM_LOCAL_FALLBACK=off،
 * LlmUnavailableError. لغو کاربر (CanceledError) همان‌طور پرتاب می‌شود و local شروع نمی‌شود.
 */
async function openAiFirst<T>(
  config: OpenAiConfig | null,
  openAi: (config: OpenAiConfig) => Promise<T>,
  local: () => Promise<T>,
  allowLocal = localFallback(),
): Promise<T> {
  if (config && Date.now() >= openAiDownUntil) {
    try {
      const result = await openAi(config);
      if (openAiDownUntil) logger.log('OpenAI is answering again');
      openAiDownUntil = 0;
      return result;
    } catch (error) {
      if (isCancel(error)) throw error;
      const status = (error as AxiosError)?.response?.status;
      const reason = status ? `HTTP ${status}` : (error as Error).message;
      if (isOutage(error)) {
        openAiDownUntil = Date.now() + config.retryAfterMs;
        logger.warn(`OpenAI unavailable (${reason}); not tried for the next ${config.retryAfterMs / 1000}s`);
      } else {
        // ایراد همین درخواست (مثلاً schema یا فایل صوتی) -- باید دیده شود
        logger.error(`OpenAI rejected the request (${reason}): ${JSON.stringify((error as AxiosError).response?.data)}`);
      }
    }
  }
  if (!allowLocal) throw new LlmUnavailableError();
  return local();
}

/**
 * مهلت قطعی یک درخواست به OpenAI، با برقراری اتصال: timeout خود axios فقط بعد از وصل شدن شمرده
 * می‌شود و اتصالی که وسط برقرار شدن گیر کند («connect ETIMEDOUT») تا چند دقیقه منتظر می‌ماند (ویس
 * پنج دقیقه در «در حال تبدیل» ماند). تمام شدن مهلت مثل قطعی است؛ لغو کاربر همان CanceledError می‌ماند.
 */
async function withDeadline<T>(ms: number, userSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(ms);
  try {
    return await run(userSignal ? AbortSignal.any([deadline, userSignal]) : deadline);
  } catch (error) {
    if (deadline.aborted && !userSignal?.aborted) throw new Error(`no answer within ${ms}ms`);
    throw error;
  }
}

// مدل‌های استدلالی (reasoning) temperature/top_p را رد می‌کنند؛ بعد از اولین رد، برای آن مدل فرستاده نمی‌شوند
const modelsWithoutSampling = new Set<string>();

const rejectsSampling = (error: unknown) => {
  const response = (error as AxiosError<{ error?: { param?: string } }>)?.response;
  return response?.status === 400 && ['temperature', 'top_p'].includes(response.data?.error?.param ?? '');
};

async function openAiChat(request: LlmChatRequest, config: OpenAiConfig): Promise<string> {
  const { messages, format, options, timeoutMs, signal } = request;
  const wait = Math.min(config.timeoutMs, timeoutMs || Infinity);
  const send = () =>
    withDeadline(wait, signal, (deadline) => axios.post(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        messages: messages.map(openAiMessage),
        ...(format && {
          // strict نه: schemaهای فعلی همه‌ی فیلدها را required ندارند (شرط حالت strict)
          response_format: { type: 'json_schema', json_schema: { name: 'output', schema: format, strict: false } },
        }),
        ...(!modelsWithoutSampling.has(config.model) && {
          ...(typeof options?.temperature === 'number' && { temperature: options.temperature }),
          ...(typeof options?.top_p === 'number' && { top_p: options.top_p }),
        }),
      },
      {
        headers: { Authorization: `Bearer ${config.key}` },
        timeout: wait,
        signal: deadline,
        ...outboundAxios(),
      },
    ));
  let response;
  try {
    response = await send();
  } catch (error) {
    if (!rejectsSampling(error) || modelsWithoutSampling.has(config.model)) throw error;
    modelsWithoutSampling.add(config.model);
    logger.log(`${config.model} does not take temperature/top_p; sending without them`);
    response = await send();
  }
  return response.data?.choices?.[0]?.message?.content ?? '';
}

// نوع تصویر از چند بایت اولش (base64)؛ OpenAI آدرس data با نوع درست می‌خواهد
function imageMime(base64: string): string {
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  return 'image/jpeg';
}

function openAiMessage({ role, content, images }: LlmMessage) {
  if (!images?.length) return { role, content };
  return {
    role,
    content: [
      { type: 'text', text: content },
      ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${imageMime(image)};base64,${image}` } })),
    ],
  };
}

async function ollamaChat(request: LlmChatRequest): Promise<string> {
  const { model, timeoutMs, signal, tier: _tier, ...body } = request;
  const response = await axios.post(
    `${ollamaBase()}/api/chat`,
    { model: model ?? llmModel(), stream: false, ...body },
    { timeout: timeoutMs, signal },
  );
  return response.data?.message?.content ?? '';
}

/**
 * متن پاسخ مدل. لغو (CanceledError) همان خطای axios است؛ با LLM_LOCAL_FALLBACK=off، جواب
 * ندادن OpenAI (یا تنظیم نبودنش) LlmUnavailableError است.
 */
export async function llmChat(request: LlmChatRequest): Promise<string> {
  return (await llmAnswer(request)).content;
}

export interface LlmAnswer {
  content: string;
  source: 'openai' | 'local';
}

/** مثل llmChat، به‌علاوه‌ی اینکه کدام مدل جواب داد (مثلاً فقط جواب OpenAI کش شود). */
export async function llmAnswer(request: LlmChatRequest): Promise<LlmAnswer> {
  const local = async (): Promise<LlmAnswer> => ({ content: await ollamaChat(request), source: 'local' });
  const vision = request.messages.some((message) => message.images?.length);
  const model = vision
    ? process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL
    : (request.tier === 'light' && process.env.OPENAI_MODEL_LIGHT) || process.env.OPENAI_MODEL;
  return openAiFirst(
    openAiConfig(model, Number(process.env.OPENAI_TIMEOUT_MS) || 15_000),
    async (config): Promise<LlmAnswer> => ({ content: await openAiChat(request, config), source: 'openai' }),
    local,
  );
}

export interface Transcript {
  /** متن خام مدل، قبل از پاک‌سازی و اصلاح */
  text: string;
  /** مدلی که متن را ساخت (برای نمونه‌های آموزش/ارزیابی) */
  model: string;
}

/**
 * ویس به متن: اول OpenAI (OPENAI_STT_MODEL، تایم‌اوت OPENAI_STT_TIMEOUT_MS پیش‌فرض 30000)، بعد
 * local (whisper.cpp) یا با LLM_LOCAL_FALLBACK=off، LlmUnavailableError.
 */
export async function transcribeSpeech(
  audioPath: string,
  options: { language: string; prompt: string },
  local: () => Promise<Transcript>,
): Promise<Transcript> {
  return openAiFirst(
    openAiConfig(process.env.OPENAI_STT_MODEL, Number(process.env.OPENAI_STT_TIMEOUT_MS) || 30_000),
    async (config) => {
      const form = new FormData();
      form.append('file', new Blob([await readFile(audioPath)]), basename(audioPath));
      form.append('model', config.model);
      form.append('language', options.language);
      if (options.prompt) form.append('prompt', options.prompt);
      form.append('response_format', 'json');
      const response = await withDeadline(config.timeoutMs, undefined, (signal) =>
        axios.post(`${config.baseUrl}/audio/transcriptions`, form, {
          headers: { Authorization: `Bearer ${config.key}` },
          timeout: config.timeoutMs,
          signal,
          ...outboundAxios(),
        }),
      );
      return { text: response.data?.text ?? '', model: `openai/${config.model}` };
    },
    local,
  );
}

/** پاسخ مدل با format، parse‌شده. */
export async function llmJson<T>(request: LlmChatRequest): Promise<T> {
  return JSON.parse(await llmChat(request)) as T;
}

/** بردار متن‌ها با OpenAI، به همان ترتیب؛ قطعی یا تنظیم نبودن OpenAI یعنی LlmUnavailableError. */
export async function embedMany(input: string[]): Promise<number[][]> {
  if (!input.length) return [];
  return openAiFirst(
    openAiConfig(embeddingModel(), Number(process.env.OPENAI_TIMEOUT_MS) || 15_000),
    async (config) => {
      const response = await withDeadline(config.timeoutMs, undefined, (signal) =>
        axios.post(
          `${config.baseUrl}/embeddings`,
          { model: config.model, input, dimensions: Number(process.env.EMBEDDING_DIMENSIONS) || 1024 },
          { headers: { Authorization: `Bearer ${config.key}` }, timeout: config.timeoutMs, signal, ...outboundAxios() },
        ),
      );
      const rows = (response.data?.data ?? []) as Array<{ index: number; embedding: number[] }>;
      return [...rows].sort((a, b) => a.index - b.index).map((row) => row.embedding);
    },
    async () => {
      throw new LlmUnavailableError();
    },
    false,
  );
}

export async function embed(text: string): Promise<number[]> {
  return (await embedMany([text]))[0];
}

/** فقط برای تست: وضعیت قطعی OpenAI را صفر می‌کند. */
export function resetOpenAiState(): void {
  openAiDownUntil = 0;
  modelsWithoutSampling.clear();
}
