import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  WASocket,
  WAMessage,
  proto,
} from '@whiskeysockets/baileys' with { 'resolution-mode': 'import' };
import { Boom } from '@hapi/boom';
import { Agent as HttpsAgent } from 'node:https';
import { pino } from 'pino';
import * as qrcode from 'qrcode-terminal';
import { join } from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { WhatsappAuthCredential } from 'src/domain/entities/agent/WhatsappAuthCredential';
import { WhatsappAuthKey } from 'src/domain/entities/agent/WhatsappAuthKey';
import { WhatsappUserMapping } from 'src/domain/entities/agent/WhatsappUserMapping';
import { useDbAuthState } from '../hooks/useDbAuthState';
import { FunctionCallService } from './functioncall.service';
import { AgentRequest } from '../types';
import { PhoneAccountService } from 'src/services/auth/phoneAccount.service';
import { AccountType } from 'src/domain/enums/subscription';
import { FactoryInviteHandler, FactoryInviteResult, inviteIn, MessengerInvite } from 'src/services/messengerBot/core/factoryInvite';
import { SubscriptionAccessService } from 'src/services/subscription/subscriptionAccess.service';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { dialablePhones } from 'src/services/messengerBot/core/dialablePhones';
import { RedisService } from 'src/services/redis/redis.service';
import { SpeechToTextService } from './Speechtotext.service';
import { LlmUnavailableError } from 'src/services/common/llmClient';
import { TranscriptCorrectorService } from './transcriptCorrector.service';

import { VoiceCodeResolverService } from './voiceCodeResolver.service';
import { parseChoice, parseYesNo, voiceMenuPrompt } from './replyChoice';
import { WhatsappPollService } from './whatsappPoll.service';
import { WhatsappMenuMessages } from './whatsappMenuMessages';
import { whatsappOptions } from 'src/services/messengerBot/core/botCard';
import { PendingConfirmationService } from './PendingConfirmationService';
import { MessengerPlatform } from 'src/domain/enums/messenger';
import { CompanyChannelsDialog } from 'src/services/channel/companyChannelsDialog';


const DEFAULT_SESSION_ID = 'main';

// فاصله‌ی بین اعلان‌های سیستمی (بار، وضعیت عضویت): چند پیام پشت‌سرهم به
// آدم‌های مختلف در یک ثانیه الگوی کلاسیک اسپم است و شماره را بن می‌کند.
const NOTIFICATION_MIN_GAP_MS = Number(process.env.WHATSAPP_NOTIFICATION_MIN_GAP_MS) || 4000;
const NOTIFICATION_JITTER_MS = Number(process.env.WHATSAPP_NOTIFICATION_JITTER_MS) || 4000;


// کلمه‌های کنترلی که کاربر در واتس‌اپ می‌نویسد؛ معادل ترکی قبلی هم پذیرفته می‌شود.
const CANCEL_WORDS = ['لغو', 'انصراف', 'نه', 'iptal', 'vazgeç', 'hayır'];
// پیام ورود برای شماره‌ای که هنوز به حسابی وصل نشده (متن، ویس و فایل).
// حساب از روی شماره‌ی خود واتساپ شناخته می‌شود (مثل دکمه‌ی «ارسال شماره» ربات‌ها)؛ نام کاربری و رمز لازم نیست.
const ONBOARDING_ACCOUNT_TYPES = [
  { type: AccountType.Driver, label: 'راننده' },
  { type: AccountType.Company, label: 'شرکت حمل‌ونقل' },
  { type: AccountType.Factory, label: 'کارخانه' },
] as const;
const ACCOUNT_TYPE_WELCOME = 'به سامانه خوش آمدید! برای این شماره هنوز حسابی ساخته نشده است.';
const ACCOUNT_TYPE_PROMPT =
  `${ACCOUNT_TYPE_WELCOME}\n\nنوع حسابتان چیست؟\n` +
  whatsappOptions(ONBOARDING_ACCOUNT_TYPES.map((item) => item.label)) +
  '\n\n👈 شماره‌ی گزینه را بفرستید.';
// سؤال نظرسنجی‌ها (منوی گفتگوها و نوع حساب)؛ فرستادن شماره‌ی گزینه هم کار می‌کند
const MENU_POLL_QUESTION = '👇 یکی را انتخاب کنید';
const UNKNOWN_PHONE_MESSAGE =
  'شماره‌ی موبایل این حساب واتساپ قابل تشخیص نیست یا شماره‌ی ایران نیست.\n' +
  'حساب‌ها با شماره‌ی موبایل ایران ساخته می‌شوند؛ لطفاً از واتساپی که با شماره‌ی ایران فعال شده پیام بدهید.';
// پاسخ دعوت کارخانه (کد inv_… که از لینک wa.me شرکت حمل‌ونقل در پیام آمده)؛ همان متن ربات‌ها
const FACTORY_INVITE_TEXT: Record<FactoryInviteResult['status'], string> = {
  joined: '✅ «{company}» شما را دعوت کرده است.\n\nاز این به بعد بارتان را با «ثبت بار» مستقیم برای این شرکت بفرستید؛ لازم نیست تماس بگیرید.',
  invalid: 'این لینک (کد) دعوت باطل شده است. لینک تازه را از شرکت حمل‌ونقل بگیرید.',
  otherNumber: 'این دعوت برای شماره‌ی دیگری است. از واتساپی پیام بدهید که با همان شماره‌ای است که به شرکت حمل‌ونقل داده‌اید.',
}
// پاسخ دعوت شخصی شرکت مادر برای شرکت حمل‌ونقل (کد cmp_…)؛ همان متن ربات‌ها
const COMPANY_INVITE_TEXT = {
  invalid: 'این لینک (کد) دعوت باطل شده است. لینک تازه را از شرکت مادر بگیرید.',
  otherNumber: 'این دعوت برای شماره‌ی دیگری است. از واتساپی پیام بدهید که با همان شماره‌ای است که به شرکت مادر داده‌اید.',
};
// پاسخ دعوت شخصی راننده از طرف شرکت حمل‌ونقل (کد drv_…)؛ همان متن ربات‌ها
const DRIVER_INVITE_TEXT: Record<FactoryInviteResult['status'], string> = {
  joined: '✅ «{company}» شما را به رانندگانش اضافه کرده است.\n\nاز این به بعد بارهای این شرکت برایتان اعلام می‌شود.',
  invalid: 'این لینک (کد) دعوت باطل شده است. لینک تازه را از شرکت حمل‌ونقل بگیرید.',
  otherNumber: 'این دعوت برای شماره‌ی دیگری است. از واتساپی پیام بدهید که با همان شماره‌ای است که به شرکت حمل‌ونقل داده‌اید.',
};
const NEW_CHAT_WORDS = ['گفتگوی جدید', 'گفتگو جدید', 'yeni sohbet'];
const NEXT_PAGE_WORDS = ['بعدی', 'ادامه', 'devam'];
const PREVIOUS_PAGE_WORDS = ['قبلی', 'برگشت', 'geri'];

/** «/start» یا «۰»: همه‌چیز از نو و منوی اصلی (واتساپ دکمه ندارد؛ یک رقم راحت‌ترین است). */
const isHomeCommand = (text: string) => /^\/start(?:@\S+)?(?:\s|$)/i.test(text.trim()) || /^[0۰٠]$/.test(text.trim());
// همان در ویس: «صفر»، «منو»، «منوی اصلی»
const HOME_VOICE = /^(?:صفر|منو|منوی اصلی|منو اصلی)$/;

/** «۱» و «١» را هم مثل «1» می‌خواند تا جواب عددی کاربر فارسی‌زبان رد نشود. */
const toLatinDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/**
 * گفتگوهای ربات (بارها، فیلترها، درخواست و سفر راننده...) در واتساپ با گزینه‌های
 * شماره‌دار. پیاده‌سازی در WhatsappDialogBridge (ماژول بارها) است و موقع
 * راه‌اندازی خودش را اینجا ثبت می‌کند تا این ماژول به آن وابسته نشود.
 */
export interface WhatsappDialogHandler {
  refreshCargoMenu?(jid: string, userId: string): Promise<void>;
  /** گزینه‌های منوی باز کاربر؛ null اگر منویی باز نیست. */
  menuLabels?(userId: string): Promise<string[] | null>;
  /** «/start»: منوی باز و نشست همه‌ی گفتگوها پاک می‌شود. */
  reset?(userId: string): Promise<void>;
  /** جواب صوتی به منوی باز (شماره یا اسم گزینه)؛ false اگر گزینه‌ای شناخته نشد. */
  handleVoiceChoice?(jid: string, userId: string, text: string): Promise<boolean>;
  /** true اگر متن مال یکی از گفتگوها بود و جواب داده شد. */
  handleText(jid: string, userId: string, text: string): Promise<boolean>;
  /** صفحه‌ی یک گفتگو (RequestResult.menuAction) برای کاربر باز می‌شود؛ false اگر آن صفحه در واتساپ نیست. */
  openAction?(jid: string, userId: string, action: string): Promise<boolean>;
  handleLocation(jid: string, userId: string, location: { latitude: number; longitude: number; live: boolean }): Promise<boolean>;
  /** فایلی که گفتگو منتظرش است (مثل اکسل بارها)؛ download فقط اگر گفتگو بخواهد. */
  handleDocument(jid: string, userId: string, document: { fileName: string; size?: number; download(): Promise<Buffer> }): Promise<boolean>;
}


const toPersianDigits = (value: number) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

// ویس نامطمئن (کد بار نامعلوم یا چند بار نزدیک): بدون سؤال و گزینه، فقط درخواست تکرار
const VOICE_UNCLEAR =
  'مطمئن نیستم درست شنیده باشم. لطفاً شمرده‌شمرده دوباره بگویید، یا اسم یا شماره‌ی گزینه را صوتی بفرستید.';

// WhatsApp cannot take a receipt; buying happens in the app or the Telegram/Bale bot.
const WHATSAPP_TRIAL_ENDED_TEXT =
  '⏳ دوره‌ی رایگان شما تمام شده است.\nبرای ادامه‌ی کار، اشتراک را از بخش «اشتراک» در برنامه‌ی ترابوت یا از ربات تلگرام/بله بخرید.';
const WHATSAPP_SUBSCRIPTION_REQUIRED_TEXT =
  'برای ادامه‌ی کار اشتراک لازم است. اشتراک را از بخش «اشتراک» در برنامه‌ی ترابوت یا از ربات تلگرام/بله بخرید.';

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private sock: WASocket | null = null;

  private notificationQueue: Promise<unknown> = Promise.resolve();

  // Real connection lifecycle state -- reconnects use backoff instead of a
  // tight loop, and nothing reconnects while the app is shutting down.
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  // Waits for in-flight session writes (from useDbAuthState) to finish.
  private flushAuthState: () => Promise<void> = async () => undefined;
  private lastNotificationAt = 0;

  //The key to the last "processing" message of each jid -- 
  //so that we can edit the same message instead of sending a new one (like Telegram's progressbar)
  private activeProgressMessages = new Map<string, proto.IMessageKey>();

  // Per-jid animation frame counter for the indeterminate progress bar --
  // safe no matter how large it grows or how many operations overlap,
  // since buildFillingBar caps its output, so growth never overflows.
  private animationFrames = new Map<string, number>();

  //Pending options -- Since WhatsApp doesn't have a real secure button,
  //  the list of options is sent in a numbered and paginated form (10 per message); 
  // here we keep track of which jid is on which page and what the actual options are, 
  // so that when a number is sent we can find the actual value
  private pendingSelections = new Map<
    string,
    { jid: string; options: { id: any; title: string }[]; page: number; message: string }
  >();

  // جدید: کلید پیامی که لیست گزینه‌ها توش فرستاده شده -- برای اینکه بعد
  // از انتخاب کاربر (یا لغو/ورق‌زدن صفحه)، همون پیام رو ادیت کنیم به‌جای
  // اینکه لیست بلند برای همیشه روی صفحه بمونه و نوار پیشرفت/نتیجه‌ی
  // نهایی رو به بالا هل بده (جایی که کاربر باید اسکرول کنه تا ببینتش).
  private selectionMessageKeys = new Map<string, proto.IMessageKey>();
  // آخرین پیام هر کاربر؛ واکنش ⏳ رویش یعنی «در حال انجام» (بدون پیام اضافه در چت)
  private lastIncoming = new Map<string, proto.IMessageKey>();

  private static readonly SELECTION_PAGE_SIZE = 10;

  private dialogHandler?: WhatsappDialogHandler;
  // FactoryDialog (cargo module) at start-up, like dialogHandler
  private factoryInvites?: FactoryInviteHandler;

  //Voice-recognized transcripts that are still waiting for user approval -- 
  // exactly equivalent to pendingTranscriptions in MessengerBotService
  private pendingTranscriptions = new Map<string, string>();
  // ویسی که کد بارش با چند بار کاربر جور شد -- متن هر گزینه به ترتیب شماره‌ها.
  private pendingCodeChoices = new Map<string, string[]>();
  // نظرسنجیِ سؤال فعلی هر jid -- رأی به نظرسنجی قدیمی‌تر کاری انجام نمی‌ده.
  private pendingPolls = new Map<string, string>();
  // نظرسنجیِ آخرین منوی گفتگوها (دکمه‌های واتساپ)؛ هر منوی تازه قبلی را بی‌اثر می‌کند.
  private menuPolls = new Map<string, string>();
  // نظرسنجی انتخاب نوع حساب برای شماره‌ای که هنوز حساب ندارد.
  private onboardingPolls = new Map<string, string>();

  constructor(
    @InjectRepository(WhatsappAuthCredential)
    private readonly credentialRepo: Repository<WhatsappAuthCredential>,
    @InjectRepository(WhatsappAuthKey)
    private readonly keyRepo: Repository<WhatsappAuthKey>,
    @InjectRepository(WhatsappUserMapping)
    private readonly userMappingRepo: Repository<WhatsappUserMapping>,
    @Inject(forwardRef(() => FunctionCallService))
    private readonly functionCallService: FunctionCallService,
    private readonly accounts: PhoneAccountService,
    private readonly speechToTextService: SpeechToTextService,
    private readonly corrector: TranscriptCorrectorService,
    private readonly voiceCodes: VoiceCodeResolverService,
    private readonly polls: WhatsappPollService,
    private readonly menuMessages: WhatsappMenuMessages,
    private readonly pendingConfirmationService: PendingConfirmationService,
    private readonly channelsDialog: CompanyChannelsDialog,
    private readonly redis: RedisService,
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) { }

  async onModuleInit() {
    // App startup doesn't wait for WhatsApp; if the first connect fails, it is retried.
    this.connect().catch((error) => {
      this.logger.error('WhatsApp connection failed', error as Error);
      this.scheduleReconnect();
    });
  }

  /**
   * Close the socket on shutdown (and every --watch restart), otherwise the
   * old and new process briefly share one session -- WhatsApp treats that as
   * a conflict and repeated conflicts can unlink the device. Then wait for
   * the last creds/keys to be written before the DB connection closes.
   */
  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.sock?.end(undefined);
    await Promise.race([
      this.flushAuthState().catch((error) =>
        this.logger.error('Final WhatsApp session save failed', error as Error),
      ),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  /** Reconnect after 2, 4, 8 ... up to 60 seconds (or right away when immediate). */
  private scheduleReconnect(immediate = false): void {
    if (this.reconnectTimer || this.isShuttingDown) return;
    const delayMs = immediate ? 0 : Math.min(2000 * 2 ** this.reconnectAttempts, 60000);
    if (!immediate) this.reconnectAttempts += 1;
    this.logger.warn(`WhatsApp reconnect in ${delayMs / 1000}s (attempt #${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        this.logger.error('WhatsApp reconnect failed', error as Error);
        this.scheduleReconnect();
      });
    }, delayMs);
  }

  /**
   * A logged-out session is not deleted: it is moved to another sessionId as
   * a backup, so the data isn't lost if the logout was a mistake. The main
   * session becomes empty so a new QR is shown.
   */
  private async archiveAuthState(): Promise<string> {
    const archiveId = `${DEFAULT_SESSION_ID}-loggedout-${Date.now()}`;
    await this.credentialRepo.manager.transaction(async (manager) => {
      await manager.update(WhatsappAuthKey, { sessionId: DEFAULT_SESSION_ID }, { sessionId: archiveId });
      await manager.update(WhatsappAuthCredential, { sessionId: DEFAULT_SESSION_ID }, { sessionId: archiveId });
    });
    return archiveId;
  }

  private async connect(): Promise<void> {
    const {
      default: makeWASocket,
      DisconnectReason,
    } = await import('@whiskeysockets/baileys');

    //#region ---------- Database Authentication State
    // Let the previous socket's pending writes finish before reading the session.
    await this.flushAuthState();
    const { state, saveCreds, flush } = await useDbAuthState(
      DEFAULT_SESSION_ID,
      this.credentialRepo,
      this.keyRepo,
    );
    this.flushAuthState = flush;
    //#endregion


    // Opens the actual WebSocket connection to WhatsApp (via Baileys).
    // From this line on, this.sock is the main object used for everything --
    // sending/receiving messages, checking connection state, etc.
    this.sock = makeWASocket({
      // The state object returned by useDbAuthState() (creds + keys). Baileys
      // uses this to determine whether this connection already has a valid,
      // previously-authorized session (QR already scanned). If valid, it
      // connects directly; if not, it generates a new QR code.
      auth: state,
      // Baileys' default behavior: if true, it would print the QR code
      // straight to the terminal on its own, with no control from us. We set
      // this to false and handle the QR ourselves instead (see the
      // connection.update event below) -- this way, if we later want to show
      // the QR on a web panel/admin screen instead of the terminal, we only
      // need to change that one event handler.
      printQRInTerminal: false, // خودمون دستی مدیریتش می‌کنیم
      // DNS returns IPv6 first for web.whatsapp.com; on a network without
      // IPv6 the websocket failed with ENETUNREACH (code 408) and no QR ever
      // appeared. Force IPv4.
      agent: new HttpsAgent({ family: 4 }),
      // Baileys' default logger is at info level and printed a JSON line for
      // every message/event; only its warnings and errors are shown now.
      logger: pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'warn' }),
    });
    // Every outgoing text/caption (replies, notifications, edits, polls) goes
    // through here: phone numbers become +98… so a tap starts a call.
    const send = this.sock.sendMessage.bind(this.sock);
    this.sock.sendMessage = ((jid, content, options) => {
      const message = content as { text?: string; caption?: string };
      const dialable =
        typeof message.text === 'string' || typeof message.caption === 'string'
          ? { ...content, ...(message.text !== undefined && { text: dialablePhones(message.text) }), ...(message.caption !== undefined && { caption: dialablePhones(message.caption) }) }
          : content;
      return send(jid, dialable as typeof content, options);
    }) as typeof send;

    // Baileys emits 'creds.update' every time the connection's core
    // credentials change -- this happens frequently, especially right after
    // the very first connection (key exchange, session setup, etc.), and
    // occasionally afterward too. Each time it fires, saveCreds() (from
    // useDbAuthState()) is called to persist the current `creds` object to
    // the database. Without this, credentials would only ever exist in memory
    // and the session would be lost on every server restart, forcing a new QR
    // scan.
    this.sock.ev.on('creds.update', saveCreds);

    // Baileys emits 'connection.update' whenever the connection's status
    // changes, or when new info (like a QR code) becomes available. The
    // `update` payload only ever contains the fields that actually changed
    // this time -- that's why everything below is checked with `if`, not
    // assumed to always be present.
    this.sock.ev.on('connection.update', (update) => {
      // Destructure the three fields we care about. Note: on any single
      // event firing, some of these may be undefined -- e.g. a QR-only
      // update won't have `connection` set to 'close' or 'open'.
      const { connection, lastDisconnect, qr } = update;

      // A new QR code became available (this fires once right after
      // connect() when there's no valid saved session yet, and again each
      // time the previous QR expires before being scanned).
      if (qr) {
        // Render it directly in the terminal as ASCII art so it can be
        // scanned with a phone camera.
        qrcode.generate(qr, { small: true });
      }

      // The connection was closed. This does NOT necessarily mean the user
      // logged out -- it fires for network drops, server restarts on
      // WhatsApp's side, timeouts, etc. too.
      if (connection === 'close') {
        // Baileys wraps connection errors in a Boom error object; the actual
        // WhatsApp-defined reason code lives at .output.statusCode.
        const disconnectError = lastDisconnect?.error as Boom | undefined;
        const statusCode = disconnectError?.output?.statusCode;
        this.logger.warn(
          `WhatsApp connection closed (code ${statusCode}): ${disconnectError?.message ?? '-'} ${
            disconnectError?.data ? JSON.stringify(disconnectError.data) : ''
          }`,
        );
        if (this.isShuttingDown) return;

        if (statusCode === DisconnectReason.restartRequired) {
          // Right after the QR scan WhatsApp closes the connection and
          // expects an immediate reconnect to finish pairing.
          this.reconnectAttempts = 0;
          this.scheduleReconnect(true);
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          // Another process opened this session. Reconnecting here makes the
          // two kick each other out until WhatsApp logs the device out.
          this.logger.error(
            'WhatsApp session opened in another process (connectionReplaced) -- not reconnecting. Run a single instance and restart.',
          );
        } else if (statusCode !== DisconnectReason.loggedOut) {
          this.scheduleReconnect();
        } else {
          // DisconnectReason.loggedOut: the saved session is permanently
          // invalid. With it still in the DB every reconnect gets 401 again
          // and no QR is ever shown -- so it is backed up and cleared.
          this.logger.error('Session logged out (loggedOut). Backing up the old session and showing a new QR.');
          void this.flushAuthState()
            .then(() => this.archiveAuthState())
            .then((archiveId) => {
              this.logger.warn(`Logged-out session backed up as sessionId "${archiveId}".`);
              this.scheduleReconnect();
            })
            .catch((error) => this.logger.error('Backing up the WhatsApp session failed', error as Error));
        }
      } else if (connection === 'open') {
        // The handshake succeeded and the socket is now fully connected and
        // ready to send/receive messages.
        this.reconnectAttempts = 0;
        this.logger.log('WhatsApp bağlantısı kuruldu.');
      }
    });

    // مرحله ۶: دریافت پیام و اتصال به pipeline موجود
    // Baileys emits 'messages.upsert' for both brand-new messages AND
    // messages being synced/updated from history -- the `type` field is what
    // tells them apart.
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // 'notify' means these are genuinely new, live messages arriving right
      // now. Any other type (e.g. 'append') means these are historical/synced
      // messages -- e.g. right after reconnecting, WhatsApp may replay old
      // messages. Without this check, a reconnect could cause old commands to
      // be re-executed as if they just arrived.
      if (type !== 'notify') return;

      // A single 'messages.upsert' event can carry MORE THAN ONE message at
      // once -- e.g. if multiple users message the bot around the same time,
      // or one user sends several messages back-to-back, they can arrive
      // batched in one event. Looping ensures none of them get silently
      // dropped.
      for (const msg of messages) {
        // Skip anything with no actual content (e.g. protocol/system
        // messages), and skip messages we sent ourselves (fromMe) -- without
        // this, the bot could end up reacting to its own replies.
        if (!msg.message || msg.key.fromMe) continue;

        // This bot only talks 1:1. Replying to groups, channels (newsletter)
        // or status broadcasts spams every member with the onboarding text
        // and is a fast way to get the number banned.
        const chatJid = msg.key.remoteJid ?? '';
        if (
          chatJid.endsWith('@g.us') ||
          chatJid.endsWith('@newsletter') ||
          chatJid.endsWith('@broadcast')
        ) {
          continue;
        }

        // NEW: WhatsApp is rolling out a new identity system called LID
        // (instead of phone numbers) -- sometimes msg.key.remoteJid arrives
        // as "xxxx@lid" instead of "xxxxxxxxxxx@s.whatsapp.net". Sending a
        // reply directly to a raw @lid jid can make sendMessage hang forever
        // (a known Baileys limitation). If remoteJidAlt is present (the real
        // phone-number-based JID), prefer that; otherwise fall back to the
        // raw remoteJid.
        const rawJid = msg.key.remoteJid;
        const jid = msg.key.remoteJid?.endsWith('@lid')
          ? (msg.key as any).remoteJidAlt || rawJid
          : rawJid;

        // No jid at all means we have no way to reply -- nothing to do here.
        if (!jid) continue;
        // ⏳ «در حال انجام» روی همین پیام کاربر می‌نشیند، نه پیام جدا (showProgress)
        this.lastIncoming.set(jid, msg.key);

        // We couldn't resolve a phone-based alternative for this @lid jid --
        // log it so we can spot how often this actually happens in practice,
        // since we're about to proceed with a jid that might hang on send.
        if (rawJid?.endsWith('@lid') && jid === rawJid) {
          this.logger.warn(
            `@lid jid için remoteJidAlt bulunamadı, ham @lid ile devam ediliyor: ${rawJid}`,
          );
        }

        // NEW: voice message handling. `ptt` (push-to-talk) is true only for
        // actual voice notes -- not regular audio file attachments (music,
        // forwarded audio, etc.), which we intentionally don't handle here.
        if (msg.message.pollUpdateMessage) {
          try {
            await this.handlePollVote(msg);
          } catch (error) {
            this.logger.error(`WhatsApp poll vote failed: ${jid}`, error as Error);
          }
          continue;
        }

        const audioMessage = msg.message.audioMessage;
        if (audioMessage?.ptt) {
          try {
            await this.handleVoiceMessage(jid, msg);
          } catch (error) {
            // Any failure in the whole voice pipeline (download, ffmpeg,
            // transcription) is caught here so it can't crash the event
            // handler or silently kill processing of the next message in
            // this batch.
            this.logger.error(`Ses mesajı işlenirken hata: ${jid}`, error as Error);
          }
          // Voice messages are fully handled above -- don't also try to
          // extract text from them below.
          continue;
        }

        // NEW: image or document attachment. The caption (if present) is
        // used as the prompt text, and the downloaded file's local path is
        // passed into the pipeline's `files` array. No pendingXxx map
        // needed here -- unlike voice, we don't ask for confirmation first,
        // since there's no transcription-accuracy risk to guard against.
        if (msg.message.locationMessage || msg.message.liveLocationMessage) {
          try {
            await this.handleLocationMessage(jid, msg);
          } catch (error) {
            this.logger.error(`Konum mesajı işlenirken hata: ${jid}`, error as Error);
          }
          continue;
        }

        const imageMessage = msg.message.imageMessage;
        const documentMessage = msg.message.documentMessage;
        if (imageMessage || documentMessage) {
          try {
            await this.handleFileMessage(jid, msg, imageMessage?.caption || documentMessage?.caption);
          } catch (error) {
            this.logger.error(`Dosya mesajı işlenirken hata: ${jid}`, error as Error);
          }
          continue;
        }

        // Plain text can arrive in one of two shapes depending on how it was
        // sent/rendered client-side: a bare `conversation` string, or an
        // `extendedTextMessage` (used e.g. when the message has formatting,
        // a quoted reply, a link preview, etc).
        const text =
          msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // Not a text message we know how to handle (e.g. an image, a
        // location, a contact card) -- nothing to process.
        if (!text) continue;

        try {
          // We pass the FULL msg.key (not just jid/text) because onboarding
          // needs it later to delete the message that contained the user's
          // password.
          await this.handleIncomingMessage(jid, text);
        } catch (error) {
          // Per-message error handling: if processing ONE message in this
          // batch throws, it's logged and the loop moves on -- it does not
          // stop the remaining messages in this same batch from being
          // processed.
          this.logger.error(`Mesaj işlenirken hata: ${jid}`, error as Error);
        }
      }
    });
  }

  // Main entry point for a single incoming TEXT message (voice messages are
  // handled separately, before this function is ever called). Returns void
  // because the actual reply doesn't come back from this function directly --
  // it's delivered later, asynchronously, via AgentGateway -> sendMessage.
  private async handleIncomingMessage(
    jid: string,
    text: string,
  ): Promise<void> {
    // Look up which system user (if any) this WhatsApp number belongs to.
    const mapping = await this.resolveUserFromJid(jid);

    // a factory invite code: the number becomes (or stays) a factory and the inviting company joins its list
    const invite = this.factoryInvites ? inviteIn(text) : null;
    if (invite && (await this.handleInvite(jid, invite, mapping?.userid ?? null))) return;

    // ---- ONBOARDING: this number isn't registered yet ----
    // If there's no mapping, we can't know which system user this is, so we
    // can't do anything else -- hand off entirely to the onboarding flow
    // (which links the account of this WhatsApp number) and stop here.
    if (!mapping) {
      await this.handleOnboardingMessage(jid, text);
      return;
    }

    const { userid, username } = mapping;
    if (await this.blockedBySubscription(jid, userid)) return;
    // «۰» (ساده‌ترین چیز برای تایپ در واتساپ) همان /start است: منوی اصلی از نو
    if (isHomeCommand(text) && this.dialogHandler) {
      await this.resetConversation(jid, userid);
      await this.dialogHandler.handleText(jid, userid, '/start');
      return;
    }

    // Checked FIRST: is this user in the middle of confirming a
    // voice-transcribed command? This takes priority over everything else
    // because it's the most specific pending state.
    if (this.pendingCodeChoices.has(jid)) {
      await this.handleCodeChoiceReply(jid, text, userid, username);
      return;
    }

    if (this.pendingTranscriptions.has(jid)) {
      await this.handleTranscriptionReply(jid, text, userid, username);
      return;
    }

    // Checked SECOND: is this user in the middle of a paginated
    // option-selection list (from a "confirm_required" generator prompt)?
    // More specific than the generic hasPendingGenerator check below,
    // because it already has the real option values, not just a raw number.
    if (this.pendingSelections.has(userid)) {
      await this.handleSelectionReply(userid, text);
      return;
    }

    // NEW: delete_* operations use a completely separate mechanism (not
    // pendingGenerators) -- PendingConfirmationService, the exact same one
    // the web side resumes via PUT /sessions/confirm-action -> runFinalStep.
    // Must be checked here too, otherwise the user's yes/no reply would be
    // misinterpreted as a brand-new command and the delete would never
    // actually run.
    const pendingConfirmation = this.pendingConfirmationService.get(userid);
    if (pendingConfirmation) {
      await this.handleDeleteConfirmationReply(jid, text, userid);
      return;
    }

    // pendingGenerators lives inside FunctionCallService as a private field,
    // so we can't check it directly -- hasPendingGenerator() is a small
    // public method added there specifically to expose this check.
    const hasPending = this.functionCallService.hasPendingGenerator(userid);

    // Try to interpret the message as a plain number (a generic fallback for
    // pending confirmations that don't have real option data attached).
    const selectionIndex = this.parseUserSelectionReply(text);

    if (hasPending) {
      // User wants to cancel whatever operation is currently paused/waiting.
      if (this.isCancelReply(text)) {
        void this.functionCallService.handleGeneratorResponse(userid, null, true, 'whatsapp');
        return;
      }

      // User replied with a number -- treat it as their answer to the
      // pending generator prompt (e.g. "which option did you mean?").
      if (selectionIndex !== null) {
        void this.functionCallService.handleGeneratorResponse(userid, selectionIndex, false, 'whatsapp');
        return;
      }

      // A generator IS waiting for an answer, but this reply is neither a
      // number nor a cancel keyword -- we deliberately do NOT fall through
      // to treating this as a brand-new command. Doing so would leave the
      // pending generator stuck forever inside FunctionCallService with no
      // way to resolve it, so instead we ask the user to clarify and stop.
      await this.sendMessage(
        jid,
        'لطفاً شماره یکی از گزینه‌ها را بفرستید یا برای لغو «لغو» بنویسید.',
      );
      return;
    }

    // گروه‌ها و کانال‌ها: همان جریان منوی تلگرام، با گزینه‌های شماره‌دار.
    // با «کانال‌ها» باز می‌شود و تا وقتی باز است شماره/لینک/«لغو» را می‌گیرد.
    if (await this.handleChannelMessage(jid, userid, text)) return;
    // بقیه‌ی بخش‌های ربات: «منو»، بارها، فیلترها، درخواست و سفر راننده، با گزینه‌های شماره‌دار
    if (this.dialogHandler && (await this.dialogHandler.handleText(jid, userid, text))) return;

    // NEW: 'yeni sohbet' -- exact WhatsApp equivalent of Telegram's /yeni
    // and the web's "new chat" button. Clears CurrentSessionId so the next
    // message starts a brand-new, empty session (no old context carried over).
    if (NEW_CHAT_WORDS.includes(text.trim().toLowerCase())) {
      await this.handleNewSessionCommand(jid, userid);
      return;
    }

    // None of the pending states applied -- this is a genuinely new command.
    await this.runCommand(userid, username, text);
  }

  /**
   * Same rule as the bots' menu (SubscriptionAccessService): a driver whose free period is over, or anyone the
   * policy asks to subscribe, can only buy. WhatsApp has no purchase flow, so it says where to buy and stops.
   * A failed check lets the message through rather than lock out a paying user.
   */
  private async blockedBySubscription(jid: string, userid: string): Promise<boolean> {
    const access = await this.subscriptionAccess.check(userid).catch((error: Error) => {
      this.logger.warn(`Subscription check for ${userid} failed: ${error.message}`);
      return null;
    });
    if (!access || access.allowed) return false;
    await this.sendMessage(jid, access.isDriver ? WHATSAPP_TRIAL_ENDED_TEXT : WHATSAPP_SUBSCRIPTION_REQUIRED_TEXT);
    return true;
  }

  setDialogHandler(handler: WhatsappDialogHandler): void {
    this.dialogHandler = handler;
  }

  setFactoryInviteHandler(handler: FactoryInviteHandler): void {
    this.factoryInvites = handler;
  }

  /**
   * An invite code, as the bots handle it; the number is WhatsApp's own. Both invites are personal: the inviter
   * made the account with the invited number beforehand (a transport company, cmp_, by the parent company; a factory,
   * inv_, and a driver, drv_, by a transport company). This number is that account (welcome, its menu) or not (another number); no
   * account or role is ever made from the code.
   * false: another number with no account, so the usual sign-up follows.
   */
  private async handleInvite(jid: string, invite: MessengerInvite, mappedUserId: string | null): Promise<boolean> {
    const handler = this.factoryInvites!;
    const texts = invite.kind === 'driver' ? DRIVER_INVITE_TEXT : FACTORY_INVITE_TEXT;
    const otherNumber = invite.kind === 'company' ? COMPANY_INVITE_TEXT.otherNumber : texts.otherNumber;
    let userId = mappedUserId;
    if (!userId) {
      const phone = await this.phoneOfJid(jid);
      if (!phone) {
        await this.sendMessage(jid, UNKNOWN_PHONE_MESSAGE);
        return true;
      }
      const user = await this.accounts.findByPhone(phone);
      if (user && user.recordStatus !== RecordStatus.Active) {
        await this.sendMessage(jid, 'حساب این شماره غیرفعال است. با پشتیبانی تماس بگیرید.');
        return true;
      }
      if (!user || !(await this.accounts.hasRole(user.id))) {
        // the invited account exists with its number: this number has none, so it is not the invited one
        await this.sendMessage(jid, otherNumber);
        return false;
      }
      await this.userMappingRepo.upsert({ userid: user.id, username: user.username, jid }, ['jid']);
      userId = user.id;
    }
    if (invite.kind === 'company') {
      const result = await handler.companyWelcome(userId, invite.token);
      await this.sendMessage(jid, result.status === 'joined' ? result.welcome : COMPANY_INVITE_TEXT[result.status]);
    } else {
      const result = invite.kind === 'driver' ? await handler.driverWelcome(userId, invite.token) : await handler.factoryWelcome(userId, invite.token);
      await this.sendMessage(jid, texts[result.status].replace('{company}', result.status === 'joined' ? result.companyName : ''));
    }
    await this.dialogHandler?.handleText(jid, userId, 'منو');
    return true;
  }

  /** لوکیشن (یا Live Location) کاربر ثبت‌شده به گفتگوهای ربات می‌رود. */
  private async handleLocationMessage(jid: string, msg: WAMessage): Promise<void> {
    const location = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
    if (!location || location.degreesLatitude == null || location.degreesLongitude == null) return;
    const mapping = await this.resolveUserFromJid(jid);
    if (!mapping || !this.dialogHandler) return;
    if (await this.blockedBySubscription(jid, mapping.userid)) return;
    const handled = await this.dialogHandler.handleLocation(jid, mapping.userid, {
      latitude: Number(location.degreesLatitude),
      longitude: Number(location.degreesLongitude),
      live: !!msg.message?.liveLocationMessage,
    });
    if (!handled) await this.sendMessage(jid, 'این نوع پیام پشتیبانی نمی‌شود.');
  }

  /** فایل با نام دلخواه (مثل فایل نمونه‌ی اکسل). */
  async sendDocument(jid: string, document: Buffer, fileName: string, mimetype: string, caption?: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(jid, { document, fileName, mimetype, caption });
  }

  /** عکس با زیرنویس (مثل نقشه‌ی مسیر و جایگاه‌های سوخت). */
  async sendImage(jid: string, image: Buffer, caption?: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(jid, { image, caption });
  }

  /** عکس با متن و گزینه‌های منو در کپشن (یک پیام به‌جای دو تا)؛ مثل sendMenuMessage ثبت می‌شود. */
  async sendMenuImage(jid: string, userId: string, image: Buffer, caption: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    this.forgetMenuPoll(jid);
    const message = await this.sock.sendMessage(jid, { image, caption });
    if (message?.key) await this.menuMessages.track(userId, message.key);
  }

  /** «در حال انجام…»: واکنش ⏳ روی آخرین پیام کاربر، تا پیام اضافه‌ای در چت نماند. */
  async showProgress(jid: string): Promise<void> {
    const key = this.lastIncoming.get(jid);
    if (key) await this.reactToNotification(key, '⏳').catch(() => undefined);
  }

  /** صفحه‌ی منوی معادل نتیجه‌ی agent (menuAction) به‌جای متن آن؛ false اگر باز نشد. */
  async openDialogAction(jid: string, userId: string, action: string): Promise<boolean> {
    return (await this.dialogHandler?.openAction?.(jid, userId, action)) ?? false;
  }

  async clearProgress(jid: string): Promise<void> {
    const key = this.lastIncoming.get(jid);
    if (key) await this.reactToNotification(key, '').catch(() => undefined);
  }

  /** پیام صوتی (ogg/opus، به شکل voice note). */
  async sendVoice(jid: string, audio: Buffer): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(jid, { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  }

  /** پین نقشه (مثلاً موقعیت راننده برای شرکت). */
  async sendLocation(jid: string, latitude: number, longitude: number): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(jid, { location: { degreesLatitude: latitude, degreesLongitude: longitude } });
  }

  /** true اگر پیام مربوط به بخش گروه‌ها و کانال‌ها بود و پاسخ داده شد. */
  private async handleChannelMessage(jid: string, userid: string, text: string): Promise<boolean> {
    // userid (uuid) به‌جای jid، چون jid ممکن است ':' داشته باشد که در کلید Redis مجاز نیست.
    const ctx = { platform: MessengerPlatform.Whatsapp, externalUserId: userid, userId: userid };
    const reply = this.channelsDialog.isTrigger(text)
      ? await this.channelsDialog.open(ctx)
      : await this.channelsDialog.handleText(ctx, text);
    if (!reply) return false;
    await this.sendMenuMessage(jid, userid, this.channelsDialog.renderNumbered(reply));
    return true;
  }

  async refreshChannelMenu(userId: string): Promise<void> {
    const ctx = { platform: MessengerPlatform.Whatsapp, externalUserId: userId, userId };
    if (!(await this.channelsDialog.hasSession(ctx))) return;
    const jid = await this.getJidForUsername(userId);
    if (!jid) return;
    const reply = await this.channelsDialog.refresh(ctx);
    if (reply) await this.sendMenuMessage(jid, userId, this.channelsDialog.renderNumbered(reply));
  }

  async refreshCargoMenu(userId: string): Promise<void> {
    if (!this.dialogHandler?.refreshCargoMenu) return;
    const jid = await this.getJidForUsername(userId);
    if (jid) await this.dialogHandler.refreshCargoMenu(jid, userId);
  }

  // Sends a piece of text into the shared agent pipeline as a brand-new
  // command. Called both from the normal text flow (a fresh message with no
  // pending state) and from the voice-confirmation flow (once the user
  // approves a transcribed command) -- hence its own method, so both paths
  // share this logic instead of duplicating it.
  private async runCommand(
    userid: string,
    username: string,
    text: string,
    files: string[] = [],
  ): Promise<void> {
    // RunFunctionCalling(prompt, req, files, sessionId) expects a `req`
    // object shaped like an Express/Nest request, because the rest of the
    // pipeline (originally built for HTTP + Telegram) reads the caller's
    // identity from req.user.userid / req.user.username. We fake that shape
    // here since WhatsApp has no real HTTP request to piggyback on.
    const req: AgentRequest = {
      user: {
        userId: userid,
        username,
      },
    };

    // NEW: previously createNewSession() was called on every single
    // message -- but since it only reuses the last session while it still
    // has ZERO submissions, the moment one command actually ran, the NEXT
    // message would get a brand-new, empty session (losing all context/
    // history from what was just created, e.g. a category the user just
    // made). The web frontend avoids this by tracking one sessionId itself
    // until the user starts a new chat -- here we replicate that by
    // persisting the session id on the WhatsappUserMapping row and only
    // creating a new one the first time.
    const mappingRow = await this.userMappingRepo.findOne({ where: { userid } });
    let sessionId = mappingRow?.CurrentSessionId;
    if (!sessionId) {
      const created = await this.functionCallService.createNewSession(userid);
      sessionId = created.sessionId;
      if (mappingRow) {
        mappingRow.CurrentSessionId = sessionId;
        await this.userMappingRepo.save(mappingRow);
      }
    }

    // RunFunctionCalling is fire-and-forget by design (it returns void; the
    // real response comes back later via AgentGateway, not through this
    // call's return value). We deliberately don't `await` it in the normal
    // sense -- but we DO attach a .catch() here (temporary, for debugging)
    // so that if something throws *before* RunFunctionCalling reaches its
    // own internal try/catch (e.g. in the session-ownership check), the
    // error gets logged instead of silently disappearing as an unhandled
    // promise rejection.
    this.functionCallService.RunFunctionCalling(text, req, files, sessionId, 'whatsapp').catch((error) => {
      this.logger.error(`RunFunctionCalling hata verdi (WhatsApp): ${userid}`, error as Error);
    });

  }

  /**
   * NEW: 'yeni sohbet' command -- WhatsApp's exact equivalent of Telegram's
   * /yeni and the web's "new chat" button. Clears CurrentSessionId so the
   * next message starts a brand-new, empty session.
   */
  private async handleNewSessionCommand(jid: string, userid: string): Promise<void> {
    const mappingRow = await this.userMappingRepo.findOne({ where: { userid } });
    if (mappingRow) {
      mappingRow.CurrentSessionId = null;
      await this.userMappingRepo.save(mappingRow);
    }
    await this.sendMessage(jid, '🆕 گفتگوی جدید شروع شد.');
  }


  // Called only for messages coming from a jid that has no entry in
  // WhatsappUserMapping yet. Like the Telegram/Bale/Rubika "send my number"
  // button, the account is the one owning this WhatsApp phone number:
  // an existing account is linked straight away; otherwise the user picks
  // driver or company (by number) and the account is created. Stateless: the
  // answer «۱»/«۲» is read from the next message of the same unlinked number.
  private async handleOnboardingMessage(jid: string, text: string): Promise<boolean> {
    const phone = await this.phoneOfJid(jid);
    if (!phone) {
      await this.sendMessage(jid, UNKNOWN_PHONE_MESSAGE);
      return false;
    }

    let user = await this.accounts.findByPhone(phone);
    if (user && user.recordStatus !== RecordStatus.Active) {
      await this.sendMessage(jid, 'حساب این شماره غیرفعال است. با پشتیبانی تماس بگیرید.');
      return false;
    }

    if (!user || !(await this.accounts.hasRole(user.id))) {
      // «۱»، «اول» یا خود نام نوع («راننده»، «شرکت»)
      const choice = parseChoice(text);
      const accountType =
        (choice ? ONBOARDING_ACCOUNT_TYPES[choice - 1]?.type : null) ??
        ONBOARDING_ACCOUNT_TYPES.find((item) => text.includes(item.label.split(' ')[0]))?.type ??
        null;
      if (!accountType) {
        await this.sendAccountTypePrompt(jid);
        return false;
      }
      this.polls.forget(this.onboardingPolls.get(jid));
      this.onboardingPolls.delete(jid);
      try {
        user = user ? await this.accounts.assignRole(user.id, accountType) : await this.accounts.create(phone, accountType);
      } catch (error) {
        this.logger.error(`WhatsApp account creation failed: ${phone}`, error as Error);
        await this.sendMessage(jid, 'ساخت حساب انجام نشد. لطفاً دوباره تلاش کنید.');
        return false;
      }
    }

    // upsert on jid: a number re-linked to another account replaces the old row.
    await this.userMappingRepo.upsert({ userid: user.id, username: user.username, jid }, ['jid']);
    await this.sendMessage(
      jid,
      `✅ حساب شماره ${phone} به این واتساپ وصل شد. از این به بعد درخواست‌هایتان را همین‌جا بفرستید.
` +
        `🌐 برای ورود به پنل وب، همین شماره را وارد کنید تا کد ورود پیامک شود؛ رمز عبوری لازم نیست.\n` +
        `🔄 هر وقت گیر کردید یا خواستید به منوی اصلی برگردید، فقط ۰ (صفر) را بفرستید.`,
    );
    await this.dialogHandler?.handleText(jid, user.id, 'منو');
    return true;
  }

  // The verified phone number behind a WhatsApp jid, as 09xxxxxxxxx. A
  // "@lid" jid (WhatsApp's newer privacy id) carries no number; Baileys'
  // LID mapping is asked for it. Only Iranian mobile numbers can hold an
  // account (SMS login is Iran-only).
  private async phoneOfJid(jid: string): Promise<string | null> {
    let pn: string | null = jid;
    if (jid.endsWith('@lid')) {
      pn = await this.sock?.signalRepository.lidMapping.getPNForLID(jid).catch(() => null) ?? null;
    }
    const digits = pn?.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/)?.[1];
    if (!digits) return null;
    const phone = normalizePhoneNumber(`+${digits}`);
    return typeof phone === 'string' && /^09[0-9]{9}$/.test(phone) ? phone : null;
  }



  // Attempts to interpret a raw text reply as a whole number selection
  // (e.g. the user typing "2" to pick the second option, or "1"/"2" to
  // answer a yes/no-style prompt). Used everywhere WhatsApp has to fall back
  // to numbered text instead of real buttons -- selection lists, voice
  // confirmations, delete confirmations, etc.
  private parseUserSelectionReply(text: string): number | null {
    // Trim first so stray whitespace (e.g. "  1 ", or a trailing newline
    // from the WhatsApp client) doesn't cause a false negative below.
    const trimmed = toLatinDigits(text.trim());

    // Number("") would be 0, not NaN -- normally not writable as
    // Number.isInteger(0) would still pass and wrongly treat an empty
    // message as "0". The explicit `trimmed !== ''` check below guards
    // against that specific edge case.
    const num = Number(trimmed);

    // Three conditions must all hold for this to count as a valid selection:
    // - Number(trimmed) actually parsed to something numeric (not "abc",
    //   not "1a", not empty -- those all produce NaN)
    // - it's a whole number, not something like "1.5" (Number.isInteger
    //   would reject a fractional value, since option numbers are always
    //   whole)
    // - the original trimmed string wasn't empty (guards the Number("") -> 0
    //   edge case mentioned above)
    if (!Number.isNaN(num) && Number.isInteger(num) && trimmed !== '') {
      return num;
    }

    // Didn't look like a plain number at all -- the caller is expected to
    // then try other interpretations (a keyword like "iptal"/"devam", or
    // fall back to treating it as a new command).
    return null;
  }

  // Checks whether a raw text reply should be treated as "cancel this
  // pending operation" -- used as a free-text alternative to the numbered
  // cancel option, wherever the user might type a word instead of (or
  // alongside) a number.
  private isCancelReply(text: string): boolean {
    // Normalize before comparing: trim stray whitespace, and lowercase so
    // "İPTAL", "Iptal", "iptal" all match the same way regardless of how
    // the user happened to type/capitalize it.
    const normalized = text.trim().toLowerCase();

    // A small fixed set of Turkish cancel words. Note this is NOT the same
    // mechanism as the numbered "2) Hayır" replies used elsewhere (voice
    // confirmation, delete confirmation) -- those are handled separately via
    // parseUserSelectionReply's numeric check. This function only covers
    // free-text cancel wording, e.g. when a pending generator selection has
    // no numbered options attached and the user just types "iptal" directly,
    // or as a redundant catch-all alongside numbered replies.
    return CANCEL_WORDS.includes(normalized);
  }


  // Entry point for voice notes (called from messages.upsert when
  // audioMessage.ptt === true). Downloads the audio, converts it, transcribes
  // it, and -- instead of executing it directly -- asks the user to confirm
  // the transcription first (speech recognition can be wrong).

  private async handleVoiceMessage(jid: string, msg: WAMessage): Promise<void> {
    // Voice messages need a known user just like text does -- an
    // unregistered number can't have a command executed on its behalf. We
    // don't attempt to transcribe unregistered users' voice notes at all,
    // since there'd be nothing useful to do with the result anyway (and it
    // would waste a speech-to-text call).
    const mapping = await this.resolveUserFromJid(jid);
    if (!mapping) {
      // حساب همین شماره وصل می‌شود؛ ویس یا فایل را کاربر بعد از وصل شدن دوباره می‌فرستد
      if (await this.handleOnboardingMessage(jid, '')) await this.sendMessage(jid, 'لطفاً پیامتان را دوباره بفرستید.');
      return;
    }
    if (await this.blockedBySubscription(jid, mapping.userid)) return;

    // Guard against calling downloadMediaMessage/sendMessage while the
    // socket isn't actually connected (e.g. mid-reconnect).
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

      // Immediate feedback -- voice processing (download + ffmpeg +
      // transcription) can take a few seconds, so the user gets some
      // indication something is happening rather than silence.
      // پیام «در حال پردازش» نه؛ ⏳ روی خود ویس (تعداد پیام‌ها کم بماند)
      await this.showProgress(jid);

      const downloadDir = join(process.cwd(), 'uploads', 'whatsapp-voice', 'downloads');
      await mkdir(downloadDir, { recursive: true });

      // Baileys-specific way of pulling the actual audio bytes for a
      // message -- unlike Telegram's simple file-id-based download, this
      // needs the full message object, a target format ('buffer' here,
      // vs. 'stream'), and a `reuploadRequest` callback so Baileys can
      // re-request the media from WhatsApp's servers if the original
      // download link has already expired.
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: this.logger as any, reuploadRequest: this.sock.updateMediaMessage },
      )) as Buffer;

      // WhatsApp voice notes come in as Opus-encoded .ogg. Filenames use a
      // timestamp + random suffix (not the original message id) purely to
      // guarantee uniqueness and avoid any chance of collision between
      // concurrent voice messages.
      const oggPath = join(
        downloadDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`,
      );
      await writeFile(oggPath, buffer);

      // منوی شماره‌دار باز است: whisper با «گزینه یک، گزینه دو…» و اسم گزینه‌ها راهنمایی
      // می‌شود تا جواب کوتاه («دو») درست شنیده شود. فایل اصلی (نه WAV) مثل ربات‌ها: سرویس
      // خودش برای whisper تبدیل می‌کند و OpenAI صدای اصلی را می‌گیرد.
      const menuLabels = await this.dialogHandler?.menuLabels?.(mapping.userid) ?? null;
      const heard = await this.speechToTextService
        .transcribeFile(oggPath, menuLabels ? { promptPrefix: voiceMenuPrompt(menuLabels) } : {}, { channel: 'whatsapp', userId: mapping.userid })
        .finally(() => unlink(oggPath).catch(() => undefined));
      // Misheard words («کار تهران…» → «بار تهران…»): the user confirms and runs the corrected text.
      const text = heard ? await this.corrector.correct(heard) : heard;

      // Transcription came back empty -- either the model failed or the
      // audio had no recognizable speech. Nothing meaningful to confirm, so
      // stop here rather than asking the user to approve an empty command.
      if (!text) {
        await this.sendMessage(jid, 'پیام صوتی به متن تبدیل نشد. لطفاً دوباره تلاش کنید.');
        return;
      }

      // Don't execute yet -- stash the transcript keyed by jid so the next
      // incoming text message from this same jid can be interpreted as a
      // confirm/cancel reply (see handleTranscriptionReply / the
      // pendingTranscriptions check at the top of handleIncomingMessage).
      // ویس جواب سؤال قبلیه («اولی»، «بله»، «لغو کن») -- همون‌طور که جواب تایپی پردازش می‌شه.
      if (this.pendingCodeChoices.has(jid) && (parseChoice(text) !== null || parseYesNo(text) === false)) {
        await this.handleCodeChoiceReply(jid, text, mapping.userid, mapping.username);
        return;
      }
      if (this.pendingTranscriptions.has(jid) && (parseChoice(text) !== null || parseYesNo(text) !== null)) {
        await this.handleTranscriptionReply(jid, text, mapping.userid, mapping.username);
        return;
      }

      // «صفر» یا «منو» در ویس همان «۰» است
      if (this.dialogHandler && HOME_VOICE.test(text.replace(/[.،!؟?]/g, '').trim())) {
        await this.resetConversation(jid, mapping.userid);
        await this.dialogHandler.handleText(jid, mapping.userid, '/start');
        return;
      }

      // جواب صوتی به منوی باز گفتگوها: «دو»، «گزینه دو» یا اسم گزینه همان گزینه را اجرا می‌کند
      // اسم بخش‌های منوی اصلی («قیمت طلا») حتی وقتی منویی باز نیست، مثل ربات‌ها
      if (!this.pendingTranscriptions.has(jid) && !this.pendingCodeChoices.has(jid)) {
        if (await this.dialogHandler?.handleVoiceChoice?.(jid, mapping.userid, text)) return;
        // جواب کوتاهی به منوی باز که گزینه‌ای نشد (مثلاً «خوتینه») دستور تازه نیست؛ دوباره بپرسیم
        if (menuLabels && text.split(/\s+/).length <= 3) {
          await this.sendMessage(jid, `🎤 «${text}»\n\nمتوجه نشدم کدام گزینه را گفتید. لطفاً شماره‌ی گزینه را بفرستید یا دوباره بگویید، مثلاً «گزینه دو».`);
          return;
        }
      }

      this.pendingTranscriptions.delete(jid);
      this.pendingCodeChoices.delete(jid);
      this.polls.forget(this.pendingPolls.get(jid));
      this.pendingPolls.delete(jid);

      // کد بار رو whisper تقریباً هیچ‌وقت دقیق نمی‌نویسه -- با بارهای خود کاربر تطبیق داده می‌شه.
      // بی‌سؤال: کسی که ویس می‌فرستد گزینه انتخاب نمی‌کند؛ اگر مطمئن نیستیم، فقط می‌خواهیم دوباره و شمرده بگوید.
      const codes = await this.voiceCodes.resolve(mapping.userid, text);
      if (codes.kind === 'unresolved' || codes.kind === 'choose') {
        await this.sendMessage(jid, `🎤 «${text}»\n\n${VOICE_UNCLEAR}`);
        return;
      }
      const command = codes.kind === 'resolved' ? codes.text : text;
      // آنچه شنیده شد نشان داده و همان لحظه اجرا می‌شود
      await this.sendMessage(jid, `🎤 «${command}»`);
      await this.runCommand(mapping.userid, mapping.username, command);
    } catch (error) {
      // Catches failures from ANY step above -- download, file I/O, ffmpeg
      // conversion, or transcription. A single catch is enough here since
      // there's no meaningfully different recovery action for each specific
      // failure point; the user just needs to know it didn't work and can
      // try again.
      this.logger.error(`Ses işleme hatası: ${jid}`, error as Error);
      // مدل ویس در دسترس نیست (OpenAI قطع و مدل محلی خاموش) -- همان پیام ربات
      await this.sendMessage(jid, error instanceof LlmUnavailableError ? error.message : 'در پردازش پیام صوتی خطایی رخ داد.');
    } finally {
      await this.clearProgress(jid);
    }
  }

  /**
   * Bir görsel (imageMessage) veya belge (documentMessage) mesajını
   * indirir ve yerel dosya yolunu pipeline'ın `files` dizisine geçirir.
   * Caption (varsa) prompt metni olarak kullanılır -- caption yoksa
   * işlenmez, çünkü RunFunctionCalling/segmentation metne ihtiyaç duyar.
   * Ses onayının aksine burada bir onay adımı YOK -- transkripsiyon
   * doğruluğu gibi bir risk söz konusu değil.
   */
  private async handleFileMessage(
    jid: string,
    msg: WAMessage,
    caption?: string | null,
  ): Promise<void> {
    const mapping = await this.resolveUserFromJid(jid);
    if (!mapping) {
      // حساب همین شماره وصل می‌شود؛ ویس یا فایل را کاربر بعد از وصل شدن دوباره می‌فرستد
      if (await this.handleOnboardingMessage(jid, '')) await this.sendMessage(jid, 'لطفاً پیامتان را دوباره بفرستید.');
      return;
    }
    if (await this.blockedBySubscription(jid, mapping.userid)) return;

    // فایل یا عکسی که یکی از گفتگوها منتظرش است (اکسل «ثبت چند بار»، رسید خرید امکانات)؛ کپشن لازم ندارد
    const document = msg.message?.documentMessage;
    const image = msg.message?.imageMessage;
    if ((document || image) && this.dialogHandler && this.sock) {
      const sock = this.sock;
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      const length = (document ?? image)?.fileLength;
      const handled = await this.dialogHandler.handleDocument(jid, mapping.userid, {
        fileName: document?.fileName ?? (image ? `photo.${image.mimetype?.split('/')[1]?.split(';')[0] || 'jpg'}` : 'file'),
        size: length ? Number(length) : undefined,
        download: async () =>
          (await downloadMediaMessage(msg, 'buffer', {}, { logger: this.logger as any, reuploadRequest: sock.updateMediaMessage })) as Buffer,
      });
      if (handled) return;
    }

    if (!caption?.trim()) {
      await this.sendMessage(
        jid,
        'لطفاً همراه فایل یا تصویر، در توضیح (کپشن) بنویسید چه کاری باید انجام شود.',
      );
      return;
    }

    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

      const downloadDir = join(process.cwd(), 'uploads', 'whatsapp-files');
      await mkdir(downloadDir, { recursive: true });

      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: this.logger as any, reuploadRequest: this.sock.updateMediaMessage },
      )) as Buffer;

      // mimetype'tan dosya uzantısını çıkarıyoruz (örn. "image/jpeg" -> "jpeg")
      // -- yoksa jenerik ".bin" ile devam ediyoruz.
      const mimetype =
        msg.message?.imageMessage?.mimetype || msg.message?.documentMessage?.mimetype || '';
      const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';

      const filePath = join(
        downloadDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
      );
      await writeFile(filePath, buffer);

      const { userid, username } = mapping;
      await this.runCommand(userid, username, caption.trim(), [filePath]);
    } catch (error) {
      this.logger.error(`Dosya işleme hatası: ${jid}`, error as Error);
      await this.sendMessage(jid, 'در پردازش فایل خطایی رخ داد.');
    }
  }


  // Handles a text reply from a jid that currently has an entry in
  // pendingTranscriptions -- i.e. the user previously sent a voice note and
  // is now expected to confirm or reject the transcribed text.
  /** نوع حساب با نظرسنجی (یک لمس)؛ اگر نشد همان متن شماره‌دار. */
  private async sendAccountTypePrompt(jid: string): Promise<void> {
    const labels = ONBOARDING_ACCOUNT_TYPES.map((item) => item.label);
    if (this.sock && this.polls.canSend(labels)) {
      // خوشامد در خود سؤال نظرسنجی: یک پیام به‌جای دو تا
      const pollId = await this.polls.send(this.sock, jid, `${ACCOUNT_TYPE_WELCOME}\n\nنوع حسابتان را انتخاب کنید 👇`, labels);
      if (pollId) {
        this.polls.forget(this.onboardingPolls.get(jid));
        this.onboardingPolls.set(jid, pollId);
        return;
      }
    }
    await this.sendMessage(jid, ACCOUNT_TYPE_PROMPT);
  }

  /** سؤال «انجام بدهم؟» به‌شکل نظرسنجی؛ false یعنی نظرسنجی نرفت و باید متن شماره‌دار فرستاده بشه. */
  private async sendConfirmPoll(jid: string, question: string): Promise<boolean> {
    if (!this.sock) return false;
    const pollId = await this.polls.send(this.sock, jid, question, ['✅ بله، انجام بده', '❌ نه، لغو کن']);
    if (!pollId) return false;
    this.pendingPolls.set(jid, pollId);
    return true;
  }

  /**
   * رأی به نظرسنجی سؤال فعلی -- مثل جواب شماره‌دار همون سؤال پردازش می‌شه
   * (گزینه‌ی n ام = «n»)، پس منطق تایید/انتخاب یک جاست.
   */
  private async handlePollVote(msg: WAMessage): Promise<void> {
    const vote = await this.polls.readVote(msg);
    if (vote.kind !== 'vote') return;
    const answer = String(vote.index + 1);

    // انتخاب نوع حساب: مثل فرستادن «۱»/«۲»
    if (this.onboardingPolls.get(vote.jid) === vote.pollId) {
      this.onboardingPolls.delete(vote.jid);
      if (!(await this.resolveUserFromJid(vote.jid))) await this.handleOnboardingMessage(vote.jid, answer);
      return;
    }
    // دکمه‌ی منوی گفتگوها: مثل فرستادن شماره‌ی گزینه
    if (this.menuPolls.get(vote.jid) === vote.pollId) {
      this.menuPolls.delete(vote.jid);
      const mapping = await this.resolveUserFromJid(vote.jid);
      if (!mapping || await this.blockedBySubscription(vote.jid, mapping.userid)) return;
      if (this.dialogHandler) await this.dialogHandler.handleText(vote.jid, mapping.userid, answer);
      return;
    }
    if (this.pendingPolls.get(vote.jid) !== vote.pollId) return;

    const mapping = await this.resolveUserFromJid(vote.jid);
    if (!mapping || await this.blockedBySubscription(vote.jid, mapping.userid)) return;

    if (this.pendingCodeChoices.has(vote.jid)) {
      await this.handleCodeChoiceReply(vote.jid, answer, mapping.userid, mapping.username);
    } else if (this.pendingTranscriptions.has(vote.jid)) {
      await this.handleTranscriptionReply(vote.jid, answer, mapping.userid, mapping.username);
    }
  }

  /** جواب انتخاب بار (وقتی کد گفته‌شده با چند بار جور شد) -- انتخاب خودش تایید کاربره. */
  private async handleCodeChoiceReply(jid: string, text: string, userid: string, username: string): Promise<void> {
    const options = this.pendingCodeChoices.get(jid);
    if (!options) return;
    const choice = this.parseUserSelectionReply(text) ?? parseChoice(text);
    const answered = () => {
      this.polls.forget(this.pendingPolls.get(jid));
      this.pendingPolls.delete(jid);
    };

    if (choice !== null && choice >= 1 && choice <= options.length) {
      answered();
      this.pendingCodeChoices.delete(jid);
      await this.sendMessage(jid, `✅ تأیید شد: «${options[choice - 1]}»`);
      await this.runCommand(userid, username, options[choice - 1]);
      return;
    }
    if (choice === options.length + 1 || parseYesNo(text) === false || this.isCancelReply(text)) {
      answered();
      this.pendingCodeChoices.delete(jid);
      await this.sendMessage(jid, '❌ لغو شد. لطفاً دوباره تلاش کنید.');
      return;
    }
    await this.sendMessage(jid, `لطفاً شماره‌ی یکی از گزینه‌ها (۱ تا ${toPersianDigits(options.length + 1)}) را بفرستید یا بگویید، مثلاً «اولی».`);
  }

  private async handleTranscriptionReply(
    jid: string,
    text: string,
    userid: string,
    username: string,
  ): Promise<void> {
    // Look up the transcript we're waiting on a reply for. In practice this
    // should always be found here (the caller only invokes this method after
    // checking pendingTranscriptions.has(jid)), but re-checking defensively
    // costs nothing and avoids a crash if that invariant is ever broken.
    const pendingText = this.pendingTranscriptions.get(jid);
    if (!pendingText) return;

    // 1 = تایید، 2 = لغو -- یا «بله»/«نه»/«یک»/«دو»، تایپی یا ویس (راننده پشت فرمون تایپ نمی‌کنه).
    const numeric = this.parseUserSelectionReply(text) ?? parseChoice(text);
    const yesNo = parseYesNo(text);
    const choice = yesNo === true ? 1 : yesNo === false ? 2 : numeric;

    if (choice === 1 || choice === 2) {
      this.polls.forget(this.pendingPolls.get(jid));
      this.pendingPolls.delete(jid);
    }

    if (choice === 1) {
      // Confirmed -- clear the pending state FIRST, so that if runCommand
      // below ends up triggering a new pending state of its own (e.g. the
      // command turns out to be ambiguous and needs a follow-up selection),
      // there's no leftover stale entry still sitting in pendingTranscriptions.
      this.pendingTranscriptions.delete(jid);
      await this.sendMessage(jid, `✅ تأیید شد: «${pendingText}»`);
      // From here on, this is handled exactly like a normal typed command --
      // full segmentation, tool selection, etc. all run fresh against the
      // confirmed transcript text.
      await this.runCommand(userid, username, pendingText);
      return;
    }

    if (choice === 2) {
      // Rejected -- just clear and stop. No pipeline call at all; the voice
      // note is simply discarded.
      this.pendingTranscriptions.delete(jid);
      await this.sendMessage(jid, '❌ لغو شد. لطفاً دوباره تلاش کنید.');
      return;
    }

    // Neither 1 nor 2 -- reply was unrecognized. Deliberately do NOT delete
    // pendingTranscriptions here (unlike the two branches above): we want to
    // keep waiting for a valid answer rather than silently dropping the
    // transcript or letting this message fall through to being treated as a
    // brand-new command.
    await this.sendMessage(jid, `لطفاً «بله» یا «نه» (یا ۱ / ۲) را بفرستید یا بگویید.`);
  }


  /**
   * pendingConfirmationService'te bir kayıt varken (delete_* operasyonları
   * için) gelen cevabı işler. Artık FunctionCallService.resumePendingConfirmation
   * TEK ortak metodunu çağırıyor -- runFinalStep/processSegments detaylarını
   * burada tekrarlamıyoruz (kalan segment'lere devam etme mantığı da orada
   * merkezi olarak yönetiliyor), aynısını web controller ve (eklenirse)
   * Telegram da çağıracak.
   */
  private async handleDeleteConfirmationReply(
    jid: string,
    text: string,
    userid: string,
  ): Promise<void> {
    const choice = this.parseUserSelectionReply(text);

    // Two ways to decline: the numbered "2", or a free-text cancel word
    // (isCancelReply) -- covering both the prompt we sent ("1) Evet / 2)
    // Hayır") and a user who just types "iptal" out of habit instead.
    if (choice === 2 || this.isCancelReply(text)) {
      await this.functionCallService.resumePendingConfirmation(userid, false, 'whatsapp');
      await this.sendMessage(jid, '❌ عملیات لغو شد.');
      return;
    }

    if (choice === 1) {
      // NOT: resumePendingConfirmation içeride agentGateway.sendToolResult'ı
      // kendisi çağırır (hem runFinalStep için hem de devam eden segment'ler
      // için) -- bu yüzden gerçek "başarılı/başarısız" cevabı zaten
      // source='whatsapp' üzerinden ayrıca WhatsappService.sendOrUpdateProgress
      // ile kullanıcıya gidecek.
      await this.functionCallService.resumePendingConfirmation(userid, true, 'whatsapp');
      return;
    }

    // Neither 1 nor 2, and not a recognized cancel word -- ask again.
    // Deliberately do NOT clear pendingConfirmationService here, so the
    // pending delete stays intact and the user can still answer correctly
    // on a follow-up message.
    await this.sendMessage(jid, `لطفاً برای تأیید ۱ و برای لغو ۲ را بفرستید.`);
  }


  // Looks up which system user (if any) a given WhatsApp jid belongs to.
  // This is the reverse direction of getJidForUsername() below -- this one
  // goes jid -> user, that one goes userid -> jid.
  private async resolveUserFromJid(
    jid: string,
  ): Promise<{ userid: string; username: string } | null> {
    // A single DB lookup against WhatsappUserMapping by jid. Since jid is
    // marked unique on the entity, this can only ever match zero or one row.
    const row = await this.userMappingRepo.findOne({ where: { jid } });

    // No mapping found -- this number hasn't completed onboarding yet.
    // Callers use this null to trigger the onboarding flow. A row without a
    // userid (left by an old failed login) is treated the same way.
    if (!row?.userid) return null;

    // Only pull out the two fields callers actually need, rather than
    // handing back the whole raw entity row.
    return { userid: row.userid, username: row.username };
  }



  // Looks up the WhatsApp number (jid) for a given system user. This is the
  // reverse direction of resolveUserFromJid() above -- this one goes
  // userid -> jid, that one goes jid -> user. Public (not private) because
  // AgentGateway needs to call this from outside the class, to figure out
  // where to route an eventual response.
  //
  // Despite the method name saying "Username", it actually looks up by
  // `userid` -- named this way to mirror MessengerBotService.getChatIdForUsername,
  // whose "userId" parameter is really the same req.user.userid value that
  // flows through AgentGateway.sendToolResult (see the comment on
  // sendYesNoConfirmation below for the same note).
  async getJidForUsername(userid: string): Promise<string | null> {
    const row = await this.userMappingRepo.findOne({ where: { userid } });

    // Optional chaining + nullish coalescing: if no row was found, `row` is
    // null/undefined and `row?.jid` short-circuits to undefined, which `??`
    // then normalizes to a plain `null` return value (rather than leaking
    // `undefined` to callers).
    return row?.jid ?? null;
  }

  // Called by AgentGateway when a "confirm_required" result comes back
  // WITHOUT an options array -- i.e. a simple yes/no confirmation (the
  // delete_* case), as opposed to sendSelectionRequest below, which handles
  // confirm_required WITH a real list of options to choose from.
  async sendYesNoConfirmation(userId: string, message: string): Promise<void> {
    // Resolve which WhatsApp number to actually send to. If this user has no
    // linked jid (shouldn't normally happen at this point in the flow, but
    // defensively handled anyway), there's nowhere to deliver the message,
    // so just bail out silently.
    const jid = await this.getJidForUsername(userId);
    if (!jid) return;

    // NEW: if the upstream handler yielded a confirmation without a
    // .message field, sendMessage's own fallback ('İşlem tamamlandı.')
    // would be misleading here -- nothing is done yet, it's asking a
    // question. Use a context-appropriate default instead.
    const finalMessage = message && message.trim() ? message : 'آیا این عملیات را تأیید می‌کنید؟';

    // Append the numbered options directly onto whatever confirmation
    // message the pipeline generated (e.g. `"X kaydını sil" işlemini
    // onaylıyor musunuz?`), so the user sees both the question and exactly
    // how to answer it in one message. This is what
    // handleDeleteConfirmationReply above expects the user to respond to
    // with "1" or "2".
    await this.sendMessage(jid, `${finalMessage}\n\n۱) بله\n۲) نه`);
  }
  // Called by AgentGateway when a "confirm_required" result comes back WITH
  // an `options` array -- e.g. multiple ambiguous matches were found and the
  // user needs to pick which one they meant. This is the WhatsApp
  // counterpart to Telegram's sendSelectionRequest, which uses real inline
  // buttons; here we fall back to a numbered, paginated text list instead
  // (see sendSelectionPage / handleSelectionReply).
  async sendSelectionRequest(
    userId: string,
    message: string,
    options: { id: any; title: string }[],
  ): Promise<void> {
    // Resolve which WhatsApp number to send this to -- same pattern as
    // sendYesNoConfirmation above.
    const jid = await this.getJidForUsername(userId);
    if (!jid) return;

    // NEW: keyed by userId (stable), not jid -- because the jid Baileys
    // resolves for a reply message can differ from the jid we looked up
    // here (WhatsApp's newer @lid identity system can resolve inconsistently
    // across messages), which previously caused the reply to never be
    // matched to this pending selection at all.
    this.pendingSelections.set(userId, { jid, options, page: 0, message });

    // Delegate the actual message formatting/sending to sendSelectionPage,
    // which slices out just the first page's worth of options (page 0) and
    // renders the numbered list + navigation hints.
    await this.sendSelectionPage(userId);
  }

  // Renders and sends ONE page of a pending selection list -- called both
  // when a selection is first started (page 0) and whenever the user
  // navigates with 'devam'/'geri' (see handleSelectionReply). Doesn't touch
  // pendingSelections itself; just reads the current state and formats a
  // message from it.
  private async sendSelectionPage(userId: string): Promise<void> {
    // If there's no pending selection for this user (e.g. it was already
    // resolved/cancelled elsewhere), there's nothing to render.
    const pending = this.pendingSelections.get(userId);
    if (!pending) return;

    const { jid, options, page, message } = pending;
    const pageSize = WhatsappService.SELECTION_PAGE_SIZE;

    // Compute this page's slice of the full options array. E.g. page 0 with
    // pageSize 10 -> indices 0..9; page 1 -> indices 10..19; etc.
    const start = page * pageSize;
    const end = start + pageSize;
    const pageOptions = options.slice(start, end);

    // Number each visible option using its GLOBAL position in the full list
    // (start + i + 1), not its position within just this page -- so option
    // #11 on page 2 is still labeled "11)", not restarting from "1)" each
    // page. This matters because the user can type a number referring to
    // any option regardless of which page is currently displayed (see
    // handleSelectionReply, which indexes into the full `options` array).
    const lines = whatsappOptions(
      pageOptions.map((option, i) => (option.title && option.title.trim() ? option.title : `گزینه ${start + i + 1}`)),
      start + 1,
    );

    // صفحه‌ی بعد، صفحه‌ی قبل و لغو هم گزینه‌ی شماره‌دارند (بعد از گزینه‌های همین صفحه)،
    // نه «بنویسید بعدی/قبلی/لغو».
    const nav = this.selectionNav(pending);
    const navLabels: string[] = [];
    if (nav.next) navLabels.push(`⬅️ ${toPersianDigits(Math.min(pageSize, options.length - end))} گزینه‌ی بعدی`);
    if (nav.prev) navLabels.push('➡️ صفحه‌ی قبل');
    navLabels.push('❌ لغو');
    const navHints = [whatsappOptions(navLabels, nav.next ?? nav.prev ?? nav.cancel), '👈 شماره‌ی گزینه را بفرستید.'];

    // Assemble the final message from up to three parts, separated by blank
    // lines:
    // 1. The original prompt/question -- but ONLY on page 0. On later pages
    //    (after 'devam'), we don't want to repeat the same question text
    //    every time the user just wants to see more options.
    // 2. The numbered option lines for this page.
    // 3. The navigation hints.
    // `.filter(Boolean)` drops the `null` entry that page > 0 produces for
    // the message part, so we don't end up with an awkward blank section.
    const text = [
      page === 0 ? message : null,
      lines,
      navHints.join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    // جدید: اگه از قبل یه پیام لیست برای این کاربر فرستاده شده (مثلاً
    // داره صفحه عوض می‌کنه)، همونو ادیت می‌کنیم -- نه یه پیام جدید. این
    // هم چت رو تمیزتر نگه می‌داره، هم باعث می‌شه بعداً (وقتی انتخاب کرد)
    // بشه همین پیام رو به یه خلاصه‌ی کوتاه تبدیل کرد.
    const existingKey = this.selectionMessageKeys.get(userId);

    if (existingKey && this.sock) {
      try {
        await this.sock.sendMessage(jid, { text, edit: existingKey });
        return;
      } catch (error) {
        this.logger.warn(`Seçim mesajı düzenlenemedi, yeni mesaj gönderiliyor: ${jid}`, error as Error);
        // devam et -- aşağıda yeni bir mesaj gönderilecek
      }
    }

    const sent = await this.sock?.sendMessage(jid, { text });
    if (sent?.key) {
      this.selectionMessageKeys.set(userId, sent.key);
      await this.menuMessages.track(userId, sent.key);
    }
  }


  // Handles a text reply from a jid that currently has an entry in
  // pendingSelections -- i.e. a numbered/paginated list of options was just
  // shown and we're waiting for the user to navigate, cancel, or pick one.
  /** شماره‌ی گزینه‌های پیمایش صفحه‌ی فعلی: بعد از آخرین گزینه‌ی همین صفحه، به ترتیب بعدی، قبلی، لغو. */
  private selectionNav(pending: { options: unknown[]; page: number }): { next?: number; prev?: number; cancel: number } {
    const end = Math.min((pending.page + 1) * WhatsappService.SELECTION_PAGE_SIZE, pending.options.length);
    let number = end + 1;
    const next = end < pending.options.length ? number++ : undefined;
    const prev = pending.page > 0 ? number++ : undefined;
    return { next, prev, cancel: number };
  }

  private async handleSelectionReply(userId: string, text: string): Promise<void> {
    const pending = this.pendingSelections.get(userId);
    if (!pending) return;

    const { jid } = pending;
    const normalized = text.trim().toLowerCase();
    const pageSize = WhatsappService.SELECTION_PAGE_SIZE;
    // شماره‌ی گزینه‌های پیمایش صفحه‌ی فعلی (بعدی/قبلی/لغو) پیش از شماره‌ی گزینه‌ها
    const nav = this.selectionNav(pending);
    const choice = this.parseUserSelectionReply(text);
    const command = choice === null ? null : choice === nav.cancel ? 'cancel' : choice === nav.next ? 'next' : choice === nav.prev ? 'prev' : null;

    // Cancel takes priority over everything else below -- if the user wants
    // out, don't bother checking if "iptal" might also coincidentally look
    // like a page-navigation keyword or a number.
    if (command === 'cancel' || this.isCancelReply(text)) {
      this.pendingSelections.delete(userId);
      await this.finalizeSelectionMessage(userId, jid, '❌ عملیات لغو شد.');
      // Resumes the underlying generator (in FunctionCallService) with
      // cancelled=true, so it can clean itself up properly (e.g. release any
      // resources, run a finally block) rather than just being abandoned in
      // memory.
      void this.functionCallService.handleGeneratorResponse(userId, null, true, 'whatsapp');
      return;
    }

    // Pagination: move forward one page, unless we're already on the last
    // page (nextStart would be past the end of the options array).
    if (command === 'next' || NEXT_PAGE_WORDS.includes(normalized)) {
      const nextStart = (pending.page + 1) * pageSize;
      if (nextStart >= pending.options.length) {
        await this.sendMessage(jid, 'گزینه دیگری وجود ندارد.');
        return;
      }
      // Mutates `pending` in place (it's a reference into the Map's value,
      // not a copy) -- no need to call pendingSelections.set() again after
      // this.
      pending.page += 1;
      await this.sendSelectionPage(userId);
      return;
    }

    // Pagination: move back one page, unless already on the first page.
    if (command === 'prev' || PREVIOUS_PAGE_WORDS.includes(normalized)) {
      if (pending.page === 0) {
        await this.sendMessage(jid, 'در صفحه اول هستید.');
        return;
      }
      pending.page -= 1;
      await this.sendSelectionPage(userId);
      return;
    }

    // Not cancel, not a navigation keyword -- try interpreting it as an
    // actual selection number.
    const selectionNumber = this.parseUserSelectionReply(text);
    if (selectionNumber === null) {
      // Didn't parse as a number either -- the reply doesn't match anything
      // we understand. Keep the pending state intact and ask again, rather
      // than guessing or falling through to treating it as a new command.
      await this.sendMessage(
        jid,
        'لطفاً شماره‌ی یکی از گزینه‌های بالا را بفرستید.',
      );
      return;
    }

    // Numbering shown to the user starts at 1 (see sendSelectionPage's
    // `start + i + 1`), so the real array index is one less than what they
    // typed.
    const selectedOption = pending.options[selectionNumber - 1];
    if (!selectedOption) {
      // A syntactically valid number, but out of range (e.g. they typed "99"
      // when there are only 20 options, or a negative/zero number). Ask
      // again rather than crashing on an out-of-bounds access.
      await this.sendMessage(jid, 'شماره نامعتبر است. لطفاً یکی از شماره‌های لیست را بفرستید.');
      return;
    }

    // Valid selection made -- clear the pending state and hand the REAL
    // underlying value (not the number the user typed) off to the generator
    // waiting for it. This is the whole reason pendingSelections stores the
    // full options array in the first place: the generator has no concept
    // of "option 3", only whatever actual value (an id, a name, etc.) that
    // option represents.
    this.pendingSelections.delete(userId);
    await this.finalizeSelectionMessage(userId, jid, `✅ انتخاب شد: ${selectedOption.title}`);
    void this.functionCallService.handleGeneratorResponse(userId, selectedOption.id, false, 'whatsapp');
  }

  /**
   * لیست بلند گزینه‌ها رو (اگه پیامش ردیابی شده باشه) به یه خلاصه‌ی کوتاه
   * ادیت می‌کنه -- تا بعد از انتخاب/لغو، دیگه لیست روی صفحه نمونه و نوار
   * پیشرفت/نتیجه‌ی نهایی رو به بالا هل نده (که کاربر مجبور بشه اسکرول
   * کنه تا ببینتش).
   */
  private async finalizeSelectionMessage(userId: string, jid: string, summary: string): Promise<void> {
    const existingKey = this.selectionMessageKeys.get(userId);
    this.selectionMessageKeys.delete(userId);

    if (!existingKey || !this.sock) {
      return;
    }

    try {
      await this.sock.sendMessage(jid, { text: summary, edit: existingKey });
    } catch (error) {
      this.logger.warn(`Seçim mesajı düzenlenemedi: ${jid}`, error as Error);
    }
  }

  // Central helper for sending a plain text message to a jid. Every other
  // method in this file that needs to reply to the user goes through this
  // one function, rather than calling this.sock.sendMessage directly -- so
  // the timeout/error protection below applies uniformly everywhere.
  async sendMessage(jid: string, text: string): Promise<void> {
    // No live socket (not connected yet, or mid-reconnect) -- nothing we can
    // do; log it so a burst of failed sends during a reconnect window is
    // visible, rather than silently swallowed.
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    // NEW: an empty/undefined text usually means an upstream caller (e.g.
    // a generator handler that yielded without a .message field) forgot to
    // set it. Rather than sending nothing or crashing, fall back to a
    // default and log a warning so the real source can be traced.
    if (!text || !text.trim()) {
      this.logger.warn(
        `sendMessage boş/undefined metinle çağrıldı (jid=${jid}) -- çağıran tarafta bir yerde .message eksik olabilir.`,
      );
      text = 'عملیات انجام شد.';
    }

    try {
      await this.sendTextWithTimeout(jid, text);
    } catch (error) {
      // Catches both: a genuine send failure from Baileys, AND our own
      // timeout rejection. Logged and swallowed -- a single failed reply
      // shouldn't crash whatever pipeline logic triggered this send (e.g.
      // AgentGateway relaying a result).
      this.logger.error(`sendMessage başarısız: ${jid}`, error as Error);
    }
  }

  async sendMenuMessage(jid: string, userId: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    // پیام تازه‌ی گفتگو: دکمه‌های منوی قبلی دیگر کاری نمی‌کنند
    this.forgetMenuPoll(jid);
    const message = await this.sendTextWithTimeout(jid, text);
    if (message?.key) await this.menuMessages.track(userId, message.key);
  }

  /** گزینه‌های این منو به شکل دکمه (نظرسنجی) نشان داده می‌شوند؟ */
  canSendMenuPoll(options: string[]): boolean {
    return !!this.sock && this.polls.canSend(options);
  }

  /** متن منو کامل در سؤال نظرسنجی جا می‌شود (منو یک پیام شود)؟ */
  fitsMenuPollQuestion(text: string): boolean {
    return this.polls.fitsQuestion(text);
  }

  /**
   * گزینه‌های منو به شکل نظرسنجی؛ question: متن کوتاه منو (یک پیام) یا بی‌سؤال بعد از
   * متن بلند منو با sendMenuMessage. رأی مثل فرستادن شماره‌ی گزینه اجرا می‌شود.
   * false اگر نرفت (آن‌وقت گزینه‌های شماره‌دار فرستاده شوند).
   */
  async sendMenuPoll(jid: string, userId: string, options: string[], question = MENU_POLL_QUESTION): Promise<boolean> {
    if (!this.sock) return false;
    const pollId = await this.polls.send(this.sock, jid, question, options);
    if (!pollId) return false;
    this.forgetMenuPoll(jid);
    this.menuPolls.set(jid, pollId);
    await this.menuMessages.track(userId, { remoteJid: jid, fromMe: true, id: pollId });
    return true;
  }

  private forgetMenuPoll(jid: string): void {
    this.polls.forget(this.menuPolls.get(jid));
    this.menuPolls.delete(jid);
  }


  /**
   * «/start»: همه‌ی منوهای قبلی کاربر از چت پاک می‌شوند و هر کار نیمه‌کاره (فرم و صفحه‌ی
   * گفتگوها، لیست انتخاب و تأیید دستیار، سؤال ویس، نظرسنجی) کنار گذاشته می‌شود تا کاربر
   * فقط منوی تازه را ببیند و جواب بعدی‌اش به سؤال قدیمی نخورد.
   */
  private async resetConversation(jid: string, userId: string): Promise<void> {
    await this.menuMessages.clear(userId, (key) => this.deleteNotification(key));
    await this.dialogHandler?.reset?.(userId);
    await this.channelsDialog.clearSession({ platform: MessengerPlatform.Whatsapp, externalUserId: userId });
    this.forgetPendingQuestions(jid, userId);
  }

  /** سؤال‌های در حافظه‌ی همین سرویس که منتظر جواب این کاربرند. */
  private forgetPendingQuestions(jid: string, userId: string): void {
    this.pendingTranscriptions.delete(jid);
    this.pendingCodeChoices.delete(jid);
    for (const polls of [this.pendingPolls, this.menuPolls, this.onboardingPolls]) {
      this.polls.forget(polls.get(jid));
      polls.delete(jid);
    }
    this.selectionMessageKeys.delete(userId);
    this.pendingSelections.delete(userId);
    this.pendingConfirmationService.clear(userId);
    // عملیات دستیار که منتظر انتخاب/تأیید است لغو می‌شود (نه اینکه تا ابد بماند)
    if (this.functionCallService.hasPendingGenerator(userId)) {
      void this.functionCallService.handleGeneratorResponse(userId, null, true, 'whatsapp');
    }
  }

  // For system notifications (e.g. new cargo alerts). Unlike sendMessage,
  // failures are thrown so the caller can record the delivery status.
  // Returns the sent message's key so it can be edited/reacted to later.
  async sendNotification(jid: string, text: string): Promise<proto.IMessageKey | null> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    // اعلان‌ها یکی‌یکی و با فاصله‌ی تصادفی فرستاده می‌شوند (ضد بن).
    const run = this.notificationQueue.then(async () => {
      const gap = NOTIFICATION_MIN_GAP_MS + Math.random() * NOTIFICATION_JITTER_MS;
      const wait = this.lastNotificationAt + gap - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        if (!this.sock) throw new Error('WhatsApp socket is not connected.');
        const sent = await this.sendTextWithTimeout(jid, text);
        return sent?.key ?? null;
      } finally {
        this.lastNotificationAt = Date.now();
      }
    });
    this.notificationQueue = run.catch(() => undefined);
    return run;
  }

  // WhatsApp only honours edits within ~15 minutes of sending; the caller
  // decides between this and reactToNotification based on the send time.
  async editNotification(key: proto.IMessageKey, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(key.remoteJid!, { text, edit: key });
  }

  async deleteNotification(key: proto.IMessageKey): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(key.remoteJid!, { delete: key });
  }

  // An empty emoji removes a previous reaction.
  async reactToNotification(key: proto.IMessageKey, emoji: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    await this.sock.sendMessage(key.remoteJid!, { react: { text: emoji, key } });
  }

  private async sendTextWithTimeout(jid: string, text: string): Promise<WAMessage | undefined> {
    // Safety timeout: certain situations (e.g. a jid in the newer @lid
    // format with no resolvable remoteJidAlt) can make sock.sendMessage hang
    // indefinitely -- a known Baileys limitation, not something we can fix
    // from our side. Without this, the `await` below would never
    // resolve/reject, and any caller awaiting it would be stuck forever too.
    const SEND_TIMEOUT_MS = 15000;

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sendMessage zaman aşımı: ${jid}`)), SEND_TIMEOUT_MS);
    });

    try {
      // Whichever settles first wins: the real send, or the timeout.
      return await Promise.race([this.sock!.sendMessage(jid, { text }), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Called repeatedly by AgentGateway during a multi-step operation (once
  // per segment/tool executed) to show progress -- mimics Telegram's
  // editMessageText behavior by editing the SAME message in place instead of
  // spamming a new message for every step. First call for a given jid sends
  // a fresh message; subsequent calls edit that same message.
  //
  // Shows a FILLING bar (grows a bit with each call, capped below 100%)
  // rather than a real percentage -- reliably counting "step X of Y" across
  // generator pause/resume and multiple segments turned out not to be
  // trustworthy (whatever the counting scheme), so instead of a fragile
  // percentage we just show incremental visual movement, capped so it can
  // never falsely claim completion before finalizeProgress actually runs.
  async sendOrUpdateProgress(jid: string, text: string): Promise<void> {
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    const frame = (this.animationFrames.get(jid) ?? 0) + 1;
    this.animationFrames.set(jid, frame);

    const displayText = `${this.buildFillingBar(frame)}\n${text}`;

    // Do we already have an in-flight "processing" message for this jid from
    // an earlier call? If so, we'll try to edit it instead of sending a new
    // one.
    const existingKey = this.activeProgressMessages.get(jid);

    if (existingKey) {
      try {
        // Baileys' way of editing a previously-sent message: send a new
        // "message" whose payload includes `edit: <key of the original
        // message>`. On success, WhatsApp replaces the original message's
        // content in place -- no new message appears in the chat.
        await this.sock.sendMessage(jid, { text: displayText, edit: existingKey });
        return;
      } catch (error) {
        // Editing can fail for reasons outside our control -- most commonly,
        // WhatsApp only allows editing a message for a limited window after
        // it was sent (roughly ~15 minutes); past that, edits are rejected.
        // Rather than treating this as fatal, we log it and deliberately
        // fall through to the "send a fresh message" logic below.
        this.logger.warn(`Mesaj düzenlenemedi, yeni mesaj gönderiliyor: ${jid}`, error as Error);
        // devam et -- aşağıda yeni bir mesaj gönderilecek
      }
    }

    // Reached either because there was no existing message yet (first call
    // for this jid), or because editing the old one just failed above.
    const sent = await this.sock.sendMessage(jid, { text: displayText });

    // Remember this new message's key so the NEXT call to
    // sendOrUpdateProgress for this same jid can edit it instead of sending
    // yet another new message.
    if (sent?.key) {
      this.activeProgressMessages.set(jid, sent.key);
    }
  }

  // Called when this is truly the LAST segment of a multi-part command --
  // sends the final result as a brand-new, distinct message (not editing
  // the shared "in progress" bubble, which previously caused earlier
  // segments' results to get silently overwritten by later ones), then
  // clears the tracked progress message so the NEXT command starts its own
  // fresh "in progress" indicator instead of continuing to edit this one.
  async finalizeProgress(jid: string, text: string): Promise<void> {
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    const displayText = `${this.buildFullBar()}\n${text}`;
    const existingKey = this.activeProgressMessages.get(jid);

    // جدید: کاربر یک نوار پیشرفت واحد برای کل دستور می‌خواد -- پس اگه
    // پیام "در حال پردازش" مشترک از قبل هست، همونو ادیت می‌کنیم به ۱۰۰٪
    // (نه پیام جدید). این یعنی برای یک دستور (چه تک‌بخشی چه چندبخشی)،
    // فقط یک حباب می‌بینه که از ابتدا تا ۱۰۰٪ ادامه پیدا می‌کنه.
    if (existingKey) {
      try {
        await this.sock.sendMessage(jid, { text: displayText, edit: existingKey });
        this.activeProgressMessages.delete(jid);
        this.animationFrames.delete(jid);
        return;
      } catch (error) {
        this.logger.warn(`Mesaj düzenlenemedi, yeni mesaj gönderiliyor: ${jid}`, error as Error);
        // devam et -- aşağıda yeni bir mesaj gönderilecek
      }
    }

    await this.sendMessage(jid, displayText);
    this.activeProgressMessages.delete(jid);
    this.animationFrames.delete(jid);
  }

  // NEW: result of a segment that is NOT the last one (more segments still
  // to come). Also sent as its own distinct message (not edited into the
  // shared bar), but unlike finalizeProgress, does NOT clear the shared
  // "in progress" tracking -- the next segment still needs to continue
  // updating that same bar.
  async sendSegmentResult(jid: string, text: string): Promise<void> {
    await this.sendMessage(jid, text);
  }

  /**
   * Builds a bar that grows with each call, capped at barLength-1 filled
   * blocks (never fully filled) -- gives a satisfying sense of progress
   * without ever falsely claiming 100% before finalizeProgress actually
   * runs. Math.min caps growth, so `step` can be arbitrarily large or
   * called any number of times without ever going out of bounds.
   */
  private buildFillingBar(step: number, barLength: number = 10): string {
    const filledCount = Math.min(barLength - 1, Math.max(1, step));
    const percent = Math.min(95, Math.round((filledCount / barLength) * 100));
    const bar = '█'.repeat(filledCount) + '░'.repeat(barLength - filledCount);
    return `[${bar}] ${percent}%`;
  }

  /**
   * A real, fully-filled bar -- only used for the genuine final result.
   */
  private buildFullBar(barLength: number = 10): string {
    return `[${'█'.repeat(barLength)}] 100%`;
  }
}
