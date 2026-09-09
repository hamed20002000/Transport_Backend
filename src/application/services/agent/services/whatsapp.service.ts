import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import makeWASocket, {
  DisconnectReason,
  WASocket,
  proto,
  downloadMediaMessage,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { WhatsappAuthCredential } from '../entities/WhatsappAuthCredential';
import { WhatsappAuthKey } from '../entities/WhatsappAuthKey';
import { WhatsappUserMapping } from '../entities/WhatsappUserMapping';
import { useDbAuthState } from '../hooks/useDbAuthState';
import { FunctionCallService } from './functioncall.service';
import { AuthService } from 'src/auth/auth.service';
import { SpeechToTextService } from './Speechtotext.service';

const execAsync = promisify(exec);

const DEFAULT_SESSION_ID = 'main';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private sock: WASocket | null = null;

  //The key to the last "processing" message of each jid -- 
  //so that we can edit the same message instead of sending a new one (like Telegram's progressbar)
  private activeProgressMessages = new Map<string, proto.IMessageKey>();

  //Pending options -- Since WhatsApp doesn't have a real secure button,
  //  the list of options is sent in a numbered and paginated form (10 per message); 
  // here we keep track of which jid is on which page and what the actual options are, 
  // so that when a number is sent we can find the actual value
  private pendingSelections = new Map<
    string,
    { userId: string; options: { value: any; label: string }[]; page: number; message: string }
  >();

  private static readonly SELECTION_PAGE_SIZE = 10;

  //Voice-recognized transcripts that are still waiting for user approval -- 
  // exactly equivalent to pendingTranscriptions in TelegramService
  private pendingTranscriptions = new Map<string, string>();

  constructor(
    @InjectRepository(WhatsappAuthCredential)
    private readonly credentialRepo: Repository<WhatsappAuthCredential>,
    @InjectRepository(WhatsappAuthKey)
    private readonly keyRepo: Repository<WhatsappAuthKey>,
    @InjectRepository(WhatsappUserMapping)
    private readonly userMappingRepo: Repository<WhatsappUserMapping>,
    @Inject(forwardRef(() => FunctionCallService))
    private readonly functionCallService: FunctionCallService,
    private readonly authService: AuthService,
    private readonly speechToTextService: SpeechToTextService,
  ) { }

  async onModuleInit() {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useDbAuthState(
      DEFAULT_SESSION_ID,
      this.credentialRepo,
      this.keyRepo,
    );

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // خودمون دستی مدیریتش می‌کنیم
    });

    // مرحله ۵: هر وقت creds عوض شد، ذخیره کن
    this.sock.ev.on('creds.update', saveCreds);

    // مرحله ۴: مدیریت QR / قطعی / وصل‌شدن
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.logger.warn(`WhatsApp bağlantısı kesildi. Yeniden bağlanılacak mı: ${shouldReconnect}`);
        if (shouldReconnect) {
          this.connect();
        } else {
          this.logger.error('Oturum kapatıldı (loggedOut). Yeni QR gerekiyor.');
        }
      } else if (connection === 'open') {
        this.logger.log('WhatsApp bağlantısı kuruldu.');
      }
    });

    // مرحله ۶: دریافت پیام و اتصال به pipeline موجود
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        // جدید: واتساپ داره به‌جای شماره‌تلفن، از یک شناسه‌ی جدید به اسم
        // LID استفاده می‌کنه -- گاهی msg.key.remoteJid به‌شکل "xxxx@lid"
        // میاد که ارسال پیام مستقیم بهش باعث hang شدن sendMessage می‌شه.
        // اگه remoteJidAlt موجود بود (نسخه‌ی JID واقعی/شماره‌تلفن)، همونو
        // ترجیح بده؛ وگرنه از remoteJid خام استفاده کن.
        const rawJid = msg.key.remoteJid;
        const jid = msg.key.remoteJid?.endsWith('@lid')
          ? (msg.key as any).remoteJidAlt || rawJid
          : rawJid;

        if (!jid) continue;

        if (rawJid?.endsWith('@lid') && jid === rawJid) {
          this.logger.warn(
            `@lid jid için remoteJidAlt bulunamadı, ham @lid ile devam ediliyor: ${rawJid}`,
          );
        }

        // جدید: پیام صوتی (ptt = true یعنی voice note، نه فایل صوتی معمولی)
        const audioMessage = msg.message.audioMessage;
        if (audioMessage?.ptt) {
          try {
            await this.handleVoiceMessage(jid, msg);
          } catch (error) {
            this.logger.error(`Ses mesajı işlenirken hata: ${jid}`, error as Error);
          }
          continue;
        }

        const text =
          msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        if (!text) continue;

        try {
          // msg'nin tamamını gönderiyoruz (sadece jid/text değil) --
          // onboarding sırasında şifre içeren mesajı silebilmek için
          // msg.key'e ihtiyacımız var
          await this.handleIncomingMessage(jid, text, msg.key);
        } catch (error) {
          this.logger.error(`Mesaj işlenirken hata: ${jid}`, error as Error);
        }
      }
    });
  }

  /**
   * ÖNEMLİ: RunFunctionCalling ve handleGeneratorResponse void döner.
   * Telegram'daki gibi, gerçek cevap AgentGateway.sendToolResult /
   * sendCurrentTool üzerinden asenkron olarak WhatsappService.sendMessage'a
   * geri gelecek (bkz. AgentGateway'e eklenecek "whatsapp" dalı).
   * Bu yüzden burada bir dönüş değeri BEKLEMİYORUZ.
   */
  private async handleIncomingMessage(
    jid: string,
    text: string,
    messageKey: proto.IMessageKey,
  ): Promise<void> {
    const mapping = await this.resolveUserFromJid(jid);

    // ---- ONBOARDING: bu numara henüz kayıtlı değil ----
    if (!mapping) {
      await this.handleOnboardingMessage(jid, text, messageKey);
      return;
    }

    const { userid, username } = mapping;

    // AgentGateway.sendToolResult / sendCurrentTool bu flag'e bakıp
    // cevabı Telegram'a mı, WhatsApp'a mı, yoksa sadece socket.io'ya mı
    // relay edeceğine karar veriyor.
    this.functionCallService.source = 'whatsapp';

    // جدید: اول چک کن آیا این کاربر منتظر تایید یک متن تشخیص‌داده‌شده
    // از صداست -- این باید قبل از هر چیز دیگه چک بشه
    if (this.pendingTranscriptions.has(jid)) {
      await this.handleTranscriptionReply(jid, text, userid, username);
      return;
    }

    // جدید: اول چک کن آیا یک انتخاب صفحه‌بندی‌شده (با گزینه‌های واقعی)
    // منتظر این jid هست -- این دقیق‌تر از حالت عمومی زیره چون خودِ
    // متن گزینه‌ها و value واقعی‌شون رو داره، نه فقط یک عدد خام
    if (this.pendingSelections.has(jid)) {
      await this.handleSelectionReply(jid, text);
      return;
    }

    // pendingGenerators FunctionCallService içinde private olduğu için,
    // FunctionCallService'e eklenen hasPendingGenerator(userid) üzerinden kontrol ediyoruz
    const hasPending = this.functionCallService.hasPendingGenerator(userid);
    const selectionIndex = this.parseUserSelectionReply(text);

    if (hasPending) {
      if (this.isCancelReply(text)) {
        void this.functionCallService.handleGeneratorResponse(userid, null, true);
        return;
      }

      if (selectionIndex !== null) {
        void this.functionCallService.handleGeneratorResponse(userid, selectionIndex, false);
        return;
      }

      // Bekleyen bir seçim/onay varken anlaşılamayan bir cevap geldi --
      // yeni bir komut gibi RunFunctionCalling'e göndermek yerine, kullanıcıdan
      // net bir cevap isteyip burada duruyoruz. Aksi halde pendingGenerators
      // içinde bu kayıt hiç temizlenmeden asılı kalırdı.
      await this.sendMessage(
        jid,
        'Lütfen bir seçenek numarası girin veya işlemi iptal etmek için "iptal" yazın.',
      );
      return;
    }

    await this.runCommand(userid, username, text);
  }

  /**
   * "Yeni bir komut" olarak RunFunctionCalling'e gönderme mantığı --
   * hem normal metin akışından, hem sesli mesaj onaylandıktan sonra
   * kullanılıyor, bu yüzden ayrı bir metoda çıkarıldı.
   */
  private async runCommand(userid: string, username: string, text: string): Promise<void> {
    // RunFunctionCalling(prompt, req, files, sessionId) bekliyor -- userid/username
    // req.user üzerinden okunuyor, ikisi de gerçek (birbirinden farklı) değerler.
    const req = {
      user: {
        userid,
        username,
      },
    };

    // createNewSession, ContextManager.hasSession/hydrate gibi metotlar
    // username üzerinden çalıştığı için, session da username ile açılıyor
    // -- Telegram tarafındaki kullanım da muhtemelen aynı şekilde.
    const { sessionId } = await this.functionCallService.createNewSession(userid);

    void this.functionCallService.RunFunctionCalling(text, req, [], sessionId);
    // NOT: burada await/response yok -- cevap AgentGateway üzerinden
    // ayrı bir çağrıyla (sendMessage) gelecek.
  }

  /**
   * Kayıtlı olmayan bir numaradan gelen mesajı, "kullaniciadi sifre" formatında
   * bir giriş denemesi olarak yorumlamaya çalışır. Format uymuyorsa, kullanıcıya
   * doğru formatı hatırlatan bir mesaj gönderir.
   */
  private async handleOnboardingMessage(
    jid: string,
    text: string,
    messageKey: proto.IMessageKey,
  ): Promise<void> {
    const parts = text.trim().split(/\s+/);

    if (parts.length !== 2) {
      await this.sendMessage(
        jid,
        'Bu numara sisteme kayıtlı değil. Lütfen kullanıcı adınızı ve şifrenizi şu formatta gönderin:\nkullaniciadi sifre',
      );
      return;
    }

    const [username, password] = parts;

    // TODO: bu metodu gerçek auth servisinize bağlayın (Telegram'ın
    // username/password doğrulaması için kullandığı servisle aynısı olmalı).
    // Şu an sadece bir placeholder -- aşağıdaki verifyCredentials'ı kendi
    // AuthService'inize göre implement edin.
    let authResult: { userid: string } | null;
    try {
      authResult = await this.verifyCredentials(username, password);
    } catch (error) {
      this.logger.error(`verifyCredentials hata verdi: ${username}`, error as Error);
      await this.deleteMessage(jid, messageKey);
      await this.sendMessage(jid, 'Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.');
      return;
    }

    // Şifre içeren mesaj artık işlendi -- sohbet geçmişinde düz metin olarak
    // kalmasın diye siliniyor (sadece bu bot'un tarafında silinir).
    await this.deleteMessage(jid, messageKey);

    if (!authResult) {
      await this.sendMessage(jid, 'Kullanıcı adı veya şifre hatalı. Lütfen tekrar deneyin.');
      return;
    }

    await this.userMappingRepo.upsert(
      { userid: authResult.userid, username, jid },
      ['jid'],
    );

    await this.sendMessage(
      jid,
      `Hoş geldiniz, ${username}! Artık komutlarınızı buradan gönderebilirsiniz.`,
    );
  }

  /**
   * Telegram tarafındaki handleLinkCommand'daki authService.validateUser çağrısıyla
   * aynı -- aynı doğrulama mantığını (şifre hash kontrolü dahil) kullanır.
   */
  private async verifyCredentials(
    username: string,
    password: string,
  ): Promise<{ userid: string } | null> {
    const result = await this.authService.validateUser({ password, username });
    if (!result) return null;
    return { userid: result.user.id };
  }

  private async deleteMessage(jid: string, messageKey: proto.IMessageKey): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(jid, { delete: messageKey });
    } catch (error) {
      this.logger.warn(`Mesaj silinemedi: ${jid}`, error as Error);
    }
  }

  /**
   * Mesajın bir seçenek numarası olup olmadığını kontrol eder.
   * Telegram'daki inline button callback_data'sının serbest metinden
   * çıkarılan karşılığı.
   */
  private parseUserSelectionReply(text: string): number | null {
    const trimmed = text.trim();
    const num = Number(trimmed);
    if (!Number.isNaN(num) && Number.isInteger(num) && trimmed !== '') {
      return num;
    }
    return null;
  }

  private isCancelReply(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    return ['iptal', 'vazgeç', 'hayır'].includes(normalized);
  }

  /**
   * Telegram'daki handleVoiceMessage'ın WhatsApp karşılığı: sesi indirir,
   * ffmpeg ile wav'a çevirir, metne dönüştürür ve -- doğrudan çalıştırmak
   * yerine -- kullanıcıdan metin onayı ister (ses tanıma yanlış olabilir).
   */
  private async handleVoiceMessage(jid: string, msg: WAMessage): Promise<void> {
    const mapping = await this.resolveUserFromJid(jid);
    if (!mapping) {
      await this.sendMessage(
        jid,
        'Bu numara sisteme kayıtlı değil. Lütfen önce kullanıcı adınızı ve şifrenizi şu formatta gönderin:\nkullaniciadi sifre',
      );
      return;
    }

    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    try {
      await this.sendMessage(jid, '🎤 Ses işleniyor...');

      // دانلود و خروجی رو توی دو پوشه‌ی جدا نگه می‌داریم -- دقیقاً همون
      // منطق TelegramService.handleVoiceMessage
      const downloadDir = join(process.cwd(), 'uploads', 'whatsapp-voice', 'downloads');
      const convertedDir = join(process.cwd(), 'uploads', 'whatsapp-voice', 'converted');
      await mkdir(downloadDir, { recursive: true });
      await mkdir(convertedDir, { recursive: true });

      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: this.logger as any, reuploadRequest: this.sock.updateMediaMessage },
      )) as Buffer;

      const oggPath = join(
        downloadDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`,
      );
      await writeFile(oggPath, buffer);

      const wavPath = join(
        convertedDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
      );
      await execAsync(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`);

      const text = await this.speechToTextService.transcribeFile(wavPath);

      if (!text) {
        await this.sendMessage(jid, 'Ses metne dönüştürülemedi. Lütfen tekrar deneyin.');
        return;
      }

      this.pendingTranscriptions.set(jid, text);

      await this.sendMessage(
        jid,
        `🎤 Şunu anladım:\n"${text}"\n\n1) Evet, çalıştır\n2) Hayır, iptal et`,
      );
    } catch (error) {
      this.logger.error(`Ses işleme hatası: ${jid}`, error as Error);
      await this.sendMessage(jid, 'Ses işlenirken bir hata oluştu.');
    }
  }

  /**
   * pendingTranscriptions'ta bir kayıt varken gelen metin cevabını işler --
   * '1' -> onaylanan metni normal komut gibi çalıştır, '2' -> iptal,
   * başka bir şey -> tekrar sor. Serbest metin ('evet'/'hayır') yerine
   * numara istemek yazım hatası riskini azaltıyor.
   */
  private async handleTranscriptionReply(
    jid: string,
    text: string,
    userid: string,
    username: string,
  ): Promise<void> {
    const pendingText = this.pendingTranscriptions.get(jid);
    if (!pendingText) return;

    const choice = this.parseUserSelectionReply(text);

    if (choice === 1) {
      this.pendingTranscriptions.delete(jid);
      await this.sendMessage(jid, `✅ Onaylandı: "${pendingText}"`);
      await this.runCommand(userid, username, pendingText);
      return;
    }

    if (choice === 2) {
      this.pendingTranscriptions.delete(jid);
      await this.sendMessage(jid, '❌ İptal edildi. Lütfen tekrar deneyin.');
      return;
    }

    // پاسخ نامفهوم بود -- دوباره منتظر بمون (پاکش نکن)
    await this.sendMessage(jid, `Lütfen 1 (Evet) veya 2 (Hayır) yazın.`);
  }

  private async resolveUserFromJid(
    jid: string,
  ): Promise<{ userid: string; username: string } | null> {
    const row = await this.userMappingRepo.findOne({ where: { jid } });
    if (!row) return null;
    return { userid: row.userid, username: row.username };
  }

  /**
   * AgentGateway.sendToolResult bunu context.req.user.userid üzerinden çağırıyor
   * (TelegramService.getChatIdForUsername'deki "userId" parametresiyle aynı anlamda) --
   * bu yüzden burada da userid alanına göre arıyoruz, username'e göre değil.
   */
  async getJidForUsername(userid: string): Promise<string | null> {
    const row = await this.userMappingRepo.findOne({ where: { userid } });
    return row?.jid ?? null;
  }

  /**
   * AgentGateway.sendToolResult bunu, data.result === "confirm_required" ve
   * options varken çağırır -- Telegram'daki sendSelectionRequest'in
   * WhatsApp karşılığı. Baileys'te gerçek buton olmadığı için, liste
   * numaralandırılmış metin olarak, ${SELECTION_PAGE_SIZE} tanesi bir arada
   * gönderiliyor (sayfalama).
   */
  async sendSelectionRequest(
    userId: string,
    message: string,
    options: { value: any; label: string }[],
  ): Promise<void> {
    const jid = await this.getJidForUsername(userId);
    if (!jid) return;

    this.pendingSelections.set(jid, { userId, options, page: 0, message });
    await this.sendSelectionPage(jid);
  }

  private async sendSelectionPage(jid: string): Promise<void> {
    const pending = this.pendingSelections.get(jid);
    if (!pending) return;

    const { options, page, message } = pending;
    const pageSize = WhatsappService.SELECTION_PAGE_SIZE;
    const start = page * pageSize;
    const end = start + pageSize;
    const pageOptions = options.slice(start, end);

    const lines = pageOptions.map((option, i) => `${start + i + 1}) ${option.label}`);

    const hasNext = end < options.length;
    const hasPrev = page > 0;

    const navHints: string[] = [];
    if (hasNext) {
      navHints.push(`'devam' yazarak sonraki ${Math.min(pageSize, options.length - end)} seçeneği görün`);
    }
    if (hasPrev) {
      navHints.push(`'geri' yazarak önceki sayfaya dönün`);
    }
    navHints.push(`İptal etmek için 'iptal' yazın`);

    const text = [
      page === 0 ? message : null,
      lines.join('\n'),
      navHints.join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    await this.sendMessage(jid, text);
  }

  /**
   * pendingSelections'ta bir kayıt varken gelen mesajı işler: sayfa
   * gezinme komutları ('devam'/'geri'), iptal, veya bir seçim numarası.
   */
  private async handleSelectionReply(jid: string, text: string): Promise<void> {
    const pending = this.pendingSelections.get(jid);
    if (!pending) return;

    const normalized = text.trim().toLowerCase();
    const pageSize = WhatsappService.SELECTION_PAGE_SIZE;

    if (this.isCancelReply(text)) {
      this.pendingSelections.delete(jid);
      void this.functionCallService.handleGeneratorResponse(pending.userId, null, true);
      return;
    }

    if (normalized === 'devam') {
      const nextStart = (pending.page + 1) * pageSize;
      if (nextStart >= pending.options.length) {
        await this.sendMessage(jid, 'Başka seçenek yok.');
        return;
      }
      pending.page += 1;
      await this.sendSelectionPage(jid);
      return;
    }

    if (normalized === 'geri') {
      if (pending.page === 0) {
        await this.sendMessage(jid, 'Zaten ilk sayfadasınız.');
        return;
      }
      pending.page -= 1;
      await this.sendSelectionPage(jid);
      return;
    }

    const selectionNumber = this.parseUserSelectionReply(text);
    if (selectionNumber === null) {
      await this.sendMessage(
        jid,
        `Lütfen listeden bir numara girin, veya 'devam' / 'geri' / 'iptal' yazın.`,
      );
      return;
    }

    // شماره‌گذاری از ۱ شروع می‌شه (نه ۰)، پس ایندکس واقعی آرایه یکی کمتره
    const selectedOption = pending.options[selectionNumber - 1];
    if (!selectedOption) {
      await this.sendMessage(jid, 'Geçersiz numara. Lütfen listedeki bir numarayı girin.');
      return;
    }

    this.pendingSelections.delete(jid);
    void this.functionCallService.handleGeneratorResponse(pending.userId, selectedOption.value, false);
  }

  // مرحله ۷: ارسال پاسخ نهایی (توسط AgentGateway صدا زده می‌شه)
  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    // جدید: یک timeout ایمنی -- بعضی حالت‌ها (مثلاً jid از نوع @lid بدون
    // remoteJidAlt) باعث می‌شن sock.sendMessage تا ابد hang کنه. بدون این
    // timeout، await هیچ‌وقت resolve/reject نمی‌شه و کد بعدی اجرا نمی‌شه.
    const SEND_TIMEOUT_MS = 15000;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`sendMessage zaman aşımı: ${jid}`)), SEND_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.sock.sendMessage(jid, { text }), timeoutPromise]);
    } catch (error) {
      this.logger.error(`sendMessage başarısız: ${jid}`, error as Error);
    }
  }

  /**
   * Telegram'daki sendOrUpdateProgress'in gerçek karşılığı -- Baileys'in
   * mesaj düzenleme (edit) özelliğini kullanır. İlk çağrıda yeni bir mesaj
   * gönderilir ve key'i saklanır; sonraki çağrılarda aynı key ile aynı
   * mesaj güncellenir (yeni mesaj gönderilmez).
   */
  async sendOrUpdateProgress(
    jid: string,
    text: string,
    currentSegment?: number,
    totalSegments?: number,
  ): Promise<void> {
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }

    const displayText =
      currentSegment && totalSegments
        ? `${this.buildProgressBar(currentSegment, totalSegments)}\n${text}`
        : text;

    const existingKey = this.activeProgressMessages.get(jid);

    if (existingKey) {
      try {
        await this.sock.sendMessage(jid, { text: displayText, edit: existingKey });
        return;
      } catch (error) {
        this.logger.warn(`Mesaj düzenlenemedi, yeni mesaj gönderiliyor: ${jid}`, error as Error);
        // devam et -- aşağıda yeni bir mesaj gönderilecek
      }
    }

    const sent = await this.sock.sendMessage(jid, { text: displayText });
    if (sent?.key) {
      this.activeProgressMessages.set(jid, sent.key);
    }
  }

  /**
   * Operasyon tamamen bittiğinde çağrılır -- son mesajı günceller ve
   * key'i temizler, çünkü bir sonraki operasyon kendi yeni "işleniyor"
   * mesajını oluşturmalı (eskisini düzenlemeye devam etmemeli).
   */
  async finalizeProgress(jid: string, text: string): Promise<void> {
    await this.sendOrUpdateProgress(jid, text);
    this.activeProgressMessages.delete(jid);
  }

  private buildProgressBar(current: number, total: number, barLength: number = 10): string {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const filledCount = total > 0 ? Math.round((current / total) * barLength) : 0;
    const bar = '█'.repeat(filledCount) + '░'.repeat(barLength - filledCount);
    return `[${bar}] ${percent}%`;
  }
}