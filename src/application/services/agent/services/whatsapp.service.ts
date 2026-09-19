import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  WASocket,
  WAMessage,
  proto,
} from '@whiskeysockets/baileys' with { 'resolution-mode': 'import' };
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { WhatsappAuthCredential } from 'src/domain/entities/agent/WhatsappAuthCredential';
import { WhatsappAuthKey } from 'src/domain/entities/agent/WhatsappAuthKey';
import { WhatsappUserMapping } from 'src/domain/entities/agent/WhatsappUserMapping';
import { useDbAuthState } from '../hooks/useDbAuthState';
import { FunctionCallService } from './functioncall.service';
import { AuthService } from 'src/auth/auth.service';
import { SpeechToTextService } from './Speechtotext.service';
import { PendingConfirmationService } from './PendingConfirmationService';

const execAsync = promisify(exec);

const DEFAULT_SESSION_ID = 'main';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private sock: WASocket | null = null;

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
    private readonly pendingConfirmationService: PendingConfirmationService,
  ) { }

  async onModuleInit() {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const {
      default: makeWASocket,
      DisconnectReason,
    } = await import('@whiskeysockets/baileys');

    //#region ---------- Database Authentication State
    const { state, saveCreds } = await useDbAuthState(
      DEFAULT_SESSION_ID,
      this.credentialRepo,
      this.keyRepo,
    );
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
    });

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
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        // DisconnectReason.loggedOut is the ONE case where reconnecting is
        // pointless -- it means the user explicitly unlinked this device
        // from their WhatsApp app, so the saved session is permanently
        // invalid. Every other disconnect reason (timeout, restart, network
        // blip, etc.) is considered recoverable.
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.logger.warn(`WhatsApp bağlantısı kesildi. Yeniden bağlanılacak mı: ${shouldReconnect}`);

        if (shouldReconnect) {
          // Recursively call connect() again to re-establish the socket.
          // Note: this re-reads the (still valid) credentials from the DB
          // via useDbAuthState(), so it does NOT require a new QR scan for
          // recoverable disconnects.
          this.connect();
        } else {
          // The session is dead for good -- someone needs to physically
          // scan a new QR code (the old WhatsappAuthCredential/Key rows for
          // this sessionId should also be cleared, otherwise Baileys will
          // keep trying to reuse a session WhatsApp has already revoked).
          this.logger.error('Oturum kapatıldı (loggedOut). Yeni QR gerekiyor.');
        }
      } else if (connection === 'open') {
        // The handshake succeeded and the socket is now fully connected and
        // ready to send/receive messages.
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
          await this.handleIncomingMessage(jid, text, msg.key);
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
    // We need the full message key (not just jid/text) so that, in the
    // onboarding path below, we can delete the message that contained the
    // user's password.
    messageKey: proto.IMessageKey,
  ): Promise<void> {
    // Look up which system user (if any) this WhatsApp number belongs to.
    const mapping = await this.resolveUserFromJid(jid);

    // ---- ONBOARDING: this number isn't registered yet ----
    // If there's no mapping, we can't know which system user this is, so we
    // can't do anything else -- hand off entirely to the onboarding flow
    // (which tries to interpret the message as "username password") and
    // stop here.
    if (!mapping) {
      await this.handleOnboardingMessage(jid, text, messageKey);
      return;
    }

    const { userid, username } = mapping;

    // AgentGateway.sendToolResult/sendCurrentTool check this flag to decide
    // where to relay the eventual response (Telegram, WhatsApp, or just the
    // web socket). Must be set before triggering ANY pipeline call below.
    this.functionCallService.source = 'whatsapp';

    // Checked FIRST: is this user in the middle of confirming a
    // voice-transcribed command? This takes priority over everything else
    // because it's the most specific pending state.
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
        void this.functionCallService.handleGeneratorResponse(userid, null, true);
        return;
      }

      // User replied with a number -- treat it as their answer to the
      // pending generator prompt (e.g. "which option did you mean?").
      if (selectionIndex !== null) {
        void this.functionCallService.handleGeneratorResponse(userid, selectionIndex, false);
        return;
      }

      // A generator IS waiting for an answer, but this reply is neither a
      // number nor a cancel keyword -- we deliberately do NOT fall through
      // to treating this as a brand-new command. Doing so would leave the
      // pending generator stuck forever inside FunctionCallService with no
      // way to resolve it, so instead we ask the user to clarify and stop.
      await this.sendMessage(
        jid,
        'Lütfen bir seçenek numarası girin veya işlemi iptal etmek için "iptal" yazın.',
      );
      return;
    }

    // NEW: 'yeni sohbet' -- exact WhatsApp equivalent of Telegram's /yeni
    // and the web's "new chat" button. Clears CurrentSessionId so the next
    // message starts a brand-new, empty session (no old context carried over).
    if (text.trim().toLowerCase() === 'yeni sohbet') {
      await this.handleNewSessionCommand(jid, userid);
      return;
    }

    // None of the pending states applied -- this is a genuinely new command.
    await this.runCommand(userid, username, text);
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
    const req = {
      user: {
        userid,
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
    this.functionCallService.RunFunctionCalling(text, req, files, sessionId).catch((error) => {
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
    await this.sendMessage(jid, '🆕 Yeni bir sohbet başlatıldı.');
  }


  // Called only for messages coming from a jid that has no entry in
  // WhatsappUserMapping yet -- i.e. the very first contact from this number,
  // or any message sent before onboarding succeeds. Tries to interpret the
  // message as "username password".
  private async handleOnboardingMessage(
    jid: string,
    text: string,
    // Needed so the password-containing message can be deleted afterward,
    // regardless of whether login succeeds or fails.
    messageKey: proto.IMessageKey,
  ): Promise<void> {
    // Split on any whitespace. A valid login attempt is expected to be
    // exactly two space-separated tokens: "username password".
    const parts = text.trim().split(/\s+/);

    // Doesn't look like "username password" at all (wrong word count) --
    // don't even attempt verification, just remind the user of the expected
    // format and stop.
    if (parts.length !== 2) {
      await this.sendMessage(
        jid,
        'Bu numara sisteme kayıtlı değil. Lütfen kullanıcı adınızı ve şifrenizi şu formatta gönderin:\nkullaniciadi sifre',
      );
      return;
    }

    const [username, password] = parts;

    // Declared outside the try block so it's still accessible afterward
    // (for the below `if (!authResult)` check) once verification succeeds.
    let authResult: { userid: string } | null;
    try {
      authResult = await this.verifyCredentials(username, password);
    } catch (error) {
      // verifyCredentials calling the real AuthService can throw for
      // reasons unrelated to "wrong password" (e.g. a DB error) -- this is
      // caught separately from a normal "invalid credentials" result so we
      // can log the unexpected failure and still give the user *some*
      // response, instead of the whole thing failing silently.
      this.logger.error(`verifyCredentials hata verdi: ${username}`, error as Error);
      // Even on an unexpected error, the message still contained a real
      // password -- delete it regardless of outcome.
      await this.deleteMessage(jid, messageKey);
      await this.sendMessage(jid, 'Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.');
      return;
    }

    // The password has now been read/processed either way (success or
    // expected failure below) -- delete the message so it doesn't remain as
    // plain, readable text sitting in the chat history.
    await this.deleteMessage(jid, messageKey);

    // verifyCredentials completed without throwing, but returned null --
    // meaning the username/password combination itself was wrong (as
    // opposed to a system error, which was already handled above).
    if (!authResult) {
      await this.sendMessage(jid, 'Kullanıcı adı veya şifre hatalı. Lütfen tekrar deneyin.');
      return;
    }

    // Login succeeded -- link this WhatsApp number to the system user going
    // forward. upsert (not save/insert) is used with `jid` as the conflict
    // column so that if this same number was previously linked to a
    // different account, it gets re-linked instead of throwing a duplicate
    // key error.
    await this.userMappingRepo.upsert(
      { userid: authResult.userid, username, jid },
      ['jid'],
    );

    // Confirm success -- from this point on, resolveUserFromJid(jid) will
    // find this mapping and treat this number as a known, logged-in user.
    await this.sendMessage(
      jid,
      `Hoş geldiniz, ${username}! Artık komutlarınızı buradan gönderebilirsiniz.`,
    );
  }



  // Thin wrapper around the real authentication service -- exists so that
  // handleOnboardingMessage doesn't need to know the exact shape of
  // AuthService's response, only this function's simplified { userid } | null
  // contract.
  private async verifyCredentials(
    username: string,
    password: string,
  ): Promise<{ userid: string } | null> {
    // Delegates the actual check (password hashing/comparison, DB lookup,
    // etc.) to the SAME AuthService used by the web login and by
    // TelegramService.handleLinkCommand -- so WhatsApp isn't running its own
    // separate, potentially inconsistent auth logic. Note the parameter
    // order here ({ password, username }) matches what AuthService.validateUser
    // expects, not necessarily the order this function's own params are in.
    const result = await this.authService.validateUser({ password, username });

    // Wrong username/password -- AuthService.validateUser returns a falsy
    // value (not a thrown error) for this case, so we normalize that to null
    // for the caller.
    if (!result) return null;

    // AuthService's full result object presumably carries more than we
    // need here (e.g. the whole user record) -- we only pass back the
    // `userid`, since that's the only piece the onboarding flow and the
    // WhatsappUserMapping row actually require.
    return { userid: result.user?.id??"" };
  }

  // Deletes a previously-sent (or previously-received) message using its
  // key. Currently only used in the onboarding flow, to remove the message
  // that contained the user's plaintext password after it's been processed.
  private async deleteMessage(jid: string, messageKey: proto.IMessageKey): Promise<void> {
    // No active connection -- nothing we can do, and nothing worth erroring
    // loudly about (deleting a message is a best-effort cleanup step, not a
    // critical operation).
    if (!this.sock) return;

    try {
      // In Baileys, "deleting" a message is done by sending a special
      // message whose payload is `{ delete: <key of the message to remove> }`,
      // rather than calling some dedicated `deleteMessage()` method. This
      // only removes the message on this bot's side of the chat (WhatsApp's
      // "delete for everyone" has its own constraints/time limits, and isn't
      // guaranteed to fully scrub it from the other device depending on
      // timing/version).
      await this.sock.sendMessage(jid, { delete: messageKey });
    } catch (error) {
      // Deletion can fail for reasons outside our control (e.g. the message
      // is too old, the other side already deleted/read it, a transient
      // connection issue). This is treated as non-fatal: we log it as a
      // warning and move on, rather than letting it interrupt the onboarding
      // flow that called this.
      this.logger.warn(`Mesaj silinemedi: ${jid}`, error as Error);
    }
  }



  // Attempts to interpret a raw text reply as a whole number selection
  // (e.g. the user typing "2" to pick the second option, or "1"/"2" to
  // answer a yes/no-style prompt). Used everywhere WhatsApp has to fall back
  // to numbered text instead of real buttons -- selection lists, voice
  // confirmations, delete confirmations, etc.
  private parseUserSelectionReply(text: string): number | null {
    // Trim first so stray whitespace (e.g. "  1 ", or a trailing newline
    // from the WhatsApp client) doesn't cause a false negative below.
    const trimmed = text.trim();

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
    return ['iptal', 'vazgeç', 'hayır'].includes(normalized);
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
      await this.sendMessage(
        jid,
        'Bu numara sisteme kayıtlı değil. Lütfen önce kullanıcı adınızı ve şifrenizi şu formatta gönderin:\nkullaniciadi sifre',
      );
      return;
    }

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
      await this.sendMessage(jid, '🎤 Ses işleniyor...');

      // Two separate directories, mirroring TelegramService's approach --
      // keeps the raw downloaded file and the ffmpeg-converted output from
      // ever colliding or being confused with each other.
      const downloadDir = join(process.cwd(), 'uploads', 'whatsapp-voice', 'downloads');
      const convertedDir = join(process.cwd(), 'uploads', 'whatsapp-voice', 'converted');
      await mkdir(downloadDir, { recursive: true });
      await mkdir(convertedDir, { recursive: true });

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

      // The speech-to-text model expects 16kHz mono PCM WAV -- same
      // conversion command used on the Telegram side, so both channels feed
      // the transcription service identical audio characteristics.
      const wavPath = join(
        convertedDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
      );
      await execAsync(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`);

      const text = await this.speechToTextService.transcribeFile(wavPath);

      // Transcription came back empty -- either the model failed or the
      // audio had no recognizable speech. Nothing meaningful to confirm, so
      // stop here rather than asking the user to approve an empty command.
      if (!text) {
        await this.sendMessage(jid, 'Ses metne dönüştürülemedi. Lütfen tekrar deneyin.');
        return;
      }

      // Don't execute yet -- stash the transcript keyed by jid so the next
      // incoming text message from this same jid can be interpreted as a
      // confirm/cancel reply (see handleTranscriptionReply / the
      // pendingTranscriptions check at the top of handleIncomingMessage).
      this.pendingTranscriptions.set(jid, text);

      // Numbered choice (rather than free-text "evet"/"hayır") to reduce the
      // chance of typos being misread as either answer.
      await this.sendMessage(
        jid,
        `🎤 Şunu anladım:\n"${text}"\n\n1) Evet, çalıştır\n2) Hayır, iptal et`,
      );
    } catch (error) {
      // Catches failures from ANY step above -- download, file I/O, ffmpeg
      // conversion, or transcription. A single catch is enough here since
      // there's no meaningfully different recovery action for each specific
      // failure point; the user just needs to know it didn't work and can
      // try again.
      this.logger.error(`Ses işleme hatası: ${jid}`, error as Error);
      await this.sendMessage(jid, 'Ses işlenirken bir hata oluştu.');
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
      await this.sendMessage(
        jid,
        'Bu numara sisteme kayıtlı değil. Lütfen önce kullanıcı adınızı ve şifrenizi şu formatta gönderin:\nkullaniciadi sifre',
      );
      return;
    }

    if (!caption?.trim()) {
      await this.sendMessage(
        jid,
        'Lütfen dosya/resimle birlikte ne yapmak istediğinizi de açıklama olarak yazın.',
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
      this.functionCallService.source = 'whatsapp';
      await this.runCommand(userid, username, caption.trim(), [filePath]);
    } catch (error) {
      this.logger.error(`Dosya işleme hatası: ${jid}`, error as Error);
      await this.sendMessage(jid, 'Dosya işlenirken bir hata oluştu.');
    }
  }


  // Handles a text reply from a jid that currently has an entry in
  // pendingTranscriptions -- i.e. the user previously sent a voice note and
  // is now expected to confirm or reject the transcribed text.
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

    // Same numeric-choice parsing used everywhere else in this file (1 =
    // confirm, 2 = reject) -- not free-text "evet"/"hayır", to keep this
    // consistent with the numbered prompt the user was just shown.
    const choice = this.parseUserSelectionReply(text);

    if (choice === 1) {
      // Confirmed -- clear the pending state FIRST, so that if runCommand
      // below ends up triggering a new pending state of its own (e.g. the
      // command turns out to be ambiguous and needs a follow-up selection),
      // there's no leftover stale entry still sitting in pendingTranscriptions.
      this.pendingTranscriptions.delete(jid);
      await this.sendMessage(jid, `✅ Onaylandı: "${pendingText}"`);
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
      await this.sendMessage(jid, '❌ İptal edildi. Lütfen tekrar deneyin.');
      return;
    }

    // Neither 1 nor 2 -- reply was unrecognized. Deliberately do NOT delete
    // pendingTranscriptions here (unlike the two branches above): we want to
    // keep waiting for a valid answer rather than silently dropping the
    // transcript or letting this message fall through to being treated as a
    // brand-new command.
    await this.sendMessage(jid, `Lütfen 1 (Evet) veya 2 (Hayır) yazın.`);
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
      await this.functionCallService.resumePendingConfirmation(userid, false);
      await this.sendMessage(jid, '❌ İşlem iptal edildi.');
      return;
    }

    if (choice === 1) {
      // NOT: resumePendingConfirmation içeride agentGateway.sendToolResult'ı
      // kendisi çağırır (hem runFinalStep için hem de devam eden segment'ler
      // için) -- bu yüzden gerçek "başarılı/başarısız" cevabı zaten
      // source='whatsapp' üzerinden ayrıca WhatsappService.sendOrUpdateProgress
      // ile kullanıcıya gidecek.
      await this.functionCallService.resumePendingConfirmation(userid, true);
      return;
    }

    // Neither 1 nor 2, and not a recognized cancel word -- ask again.
    // Deliberately do NOT clear pendingConfirmationService here, so the
    // pending delete stays intact and the user can still answer correctly
    // on a follow-up message.
    await this.sendMessage(jid, `Lütfen onaylamak için 1, iptal için 2 yazın.`);
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
    // Callers use this null to trigger the onboarding flow.
    if (!row) return null;

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
  // `userid` -- named this way to mirror TelegramService.getChatIdForUsername,
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
    const finalMessage = message && message.trim() ? message : 'Bu işlemi onaylıyor musunuz?';

    // Append the numbered options directly onto whatever confirmation
    // message the pipeline generated (e.g. `"X kaydını sil" işlemini
    // onaylıyor musunuz?`), so the user sees both the question and exactly
    // how to answer it in one message. This is what
    // handleDeleteConfirmationReply above expects the user to respond to
    // with "1" or "2".
    await this.sendMessage(jid, `${finalMessage}\n\n1) Evet\n2) Hayır`);
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
    const lines = pageOptions.map((option, i) => {
      const label = option.title && option.title.trim() ? option.title : `Seçenek ${start + i + 1}`;
      return `${start + i + 1}) ${label}`;
    });

    // Whether there are more options beyond this page, and whether we're
    // past the first page -- determines which navigation hints to show.
    const hasNext = end < options.length;
    const hasPrev = page > 0;

    const navHints: string[] = [];
    if (hasNext) {
      // Tell the user exactly how many more options are waiting on the next
      // page (capped at pageSize, in case fewer than a full page remain).
      navHints.push(`'devam' yazarak sonraki ${Math.min(pageSize, options.length - end)} seçeneği görün`);
    }
    if (hasPrev) {
      navHints.push(`'geri' yazarak önceki sayfaya dönün`);
    }
    // Cancel is always available regardless of page.
    navHints.push(`İptal etmek için 'iptal' yazın`);

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
      lines.join('\n'),
      navHints.join('\n'),
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
    }
  }


  // Handles a text reply from a jid that currently has an entry in
  // pendingSelections -- i.e. a numbered/paginated list of options was just
  // shown and we're waiting for the user to navigate, cancel, or pick one.
  private async handleSelectionReply(userId: string, text: string): Promise<void> {
    const pending = this.pendingSelections.get(userId);
    if (!pending) return;

    const { jid } = pending;
    const normalized = text.trim().toLowerCase();
    const pageSize = WhatsappService.SELECTION_PAGE_SIZE;

    // Cancel takes priority over everything else below -- if the user wants
    // out, don't bother checking if "iptal" might also coincidentally look
    // like a page-navigation keyword or a number.
    if (this.isCancelReply(text)) {
      this.pendingSelections.delete(userId);
      await this.finalizeSelectionMessage(userId, jid, '❌ İşlem iptal edildi.');
      // Resumes the underlying generator (in FunctionCallService) with
      // cancelled=true, so it can clean itself up properly (e.g. release any
      // resources, run a finally block) rather than just being abandoned in
      // memory.
      void this.functionCallService.handleGeneratorResponse(userId, null, true);
      return;
    }

    // Pagination: move forward one page, unless we're already on the last
    // page (nextStart would be past the end of the options array).
    if (normalized === 'devam') {
      const nextStart = (pending.page + 1) * pageSize;
      if (nextStart >= pending.options.length) {
        await this.sendMessage(jid, 'Başka seçenek yok.');
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
    if (normalized === 'geri') {
      if (pending.page === 0) {
        await this.sendMessage(jid, 'Zaten ilk sayfadasınız.');
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
        `Lütfen listeden bir numara girin, veya 'devam' / 'geri' / 'iptal' yazın.`,
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
      await this.sendMessage(jid, 'Geçersiz numara. Lütfen listedeki bir numarayı girin.');
      return;
    }

    // Valid selection made -- clear the pending state and hand the REAL
    // underlying value (not the number the user typed) off to the generator
    // waiting for it. This is the whole reason pendingSelections stores the
    // full options array in the first place: the generator has no concept
    // of "option 3", only whatever actual value (an id, a name, etc.) that
    // option represents.
    this.pendingSelections.delete(userId);
    await this.finalizeSelectionMessage(userId, jid, `✅ Seçildi: ${selectedOption.title}`);
    void this.functionCallService.handleGeneratorResponse(userId, selectedOption.id, false);
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
      text = 'İşlem tamamlandı.';
    }

    // Safety timeout: certain situations (e.g. a jid in the newer @lid
    // format with no resolvable remoteJidAlt) can make sock.sendMessage hang
    // indefinitely -- a known Baileys limitation, not something we can fix
    // from our side. Without this, the `await` below would never
    // resolve/reject, and any caller awaiting sendMessage() would be stuck
    // forever too.
    const SEND_TIMEOUT_MS = 15000;

    // A promise that does nothing but wait 15 seconds and then reject --
    // used purely as a race partner below, never actually "wins" under
    // normal conditions.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`sendMessage zaman aşımı: ${jid}`)), SEND_TIMEOUT_MS);
    });

    try {
      // Whichever settles first wins: either the real send completes
      // (success or Baileys throws its own error), or 15 seconds pass and
      // the timeoutPromise rejects instead. Either way, this `await` is now
      // guaranteed to eventually settle.
      await Promise.race([this.sock.sendMessage(jid, { text }), timeoutPromise]);
    } catch (error) {
      // Catches both: a genuine send failure from Baileys, AND our own
      // timeout rejection. Logged and swallowed -- a single failed reply
      // shouldn't crash whatever pipeline logic triggered this send (e.g.
      // AgentGateway relaying a result).
      this.logger.error(`sendMessage başarısız: ${jid}`, error as Error);
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