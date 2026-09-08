import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import makeWASocket, { DisconnectReason, WASocket, proto } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import { WhatsappAuthCredential } from '../entities/WhatsappAuthCredential';
import { WhatsappAuthKey } from '..//entities/WhatsappAuthKey';
import { WhatsappUserMapping } from '../entities/WhatsappUserMapping';
import { useDbAuthState } from '../hooks/useDbAuthState';
// این importها رو با مسیر واقعی پروژه‌تون جایگزین کنید
import { FunctionCallService } from './functioncall.service'; 

const DEFAULT_SESSION_ID = 'main';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private sock: WASocket | null = null;

  constructor(
    @InjectRepository(WhatsappAuthCredential)
    private readonly credentialRepo: Repository<WhatsappAuthCredential>,
    @InjectRepository(WhatsappAuthKey)
    private readonly keyRepo: Repository<WhatsappAuthKey>,
    @InjectRepository(WhatsappUserMapping)
    private readonly userMappingRepo: Repository<WhatsappUserMapping>,
    private readonly functionCallService: FunctionCallService,
  ) {}

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

        const jid = msg.key.remoteJid;
        if (!jid) continue;

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
    const { sessionId } = await this.functionCallService.createNewSession(username);

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
    const authResult = await this.verifyCredentials(username, password);

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
   * TODO: gerçek AuthService'inize bağlayın. Telegram tarafında username/password
   * doğrulaması için kullandığınız servisin aynısı buraya inject edilip
   * çağrılmalı (constructor'a ekleyin).
   */
  private async verifyCredentials(
    username: string,
    password: string,
  ): Promise<{ userid: string } | null> {
    throw new Error(
      'verifyCredentials henüz implement edilmedi -- gerçek AuthService ile değiştirin.',
    );
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

  // مرحله ۷: ارسال پاسخ نهایی (توسط AgentGateway صدا زده می‌شه)
  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) {
      this.logger.error('WhatsApp soketi hazır değil.');
      return;
    }
    await this.sock.sendMessage(jid, { text });
  }

  /**
   * Telegram'daki sendOrUpdateProgress'in karşılığı. WhatsApp'ta mesaj
   * düzenleme (edit) Baileys'te daha kısıtlı/karmaşık olduğundan, burada
   * her ilerleme adımını ayrı bir mesaj olarak gönderiyoruz. İsterseniz
   * ileride gerçek mesaj düzenlemeyi (sock.sendMessage ile edit alanı)
   * ekleyebilirsiniz.
   */
  async sendOrUpdateProgress(
    jid: string,
    text: string,
    currentSegment: number,
    totalSegments: number,
  ): Promise<void> {
    await this.sendMessage(jid, text);
  }
}