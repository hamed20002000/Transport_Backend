import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys' with { 'resolution-mode': 'import' };

// نظرسنجی‌ها فقط تا این مدت جواب می‌گیرن -- سؤال قدیمی‌تر دیگه معتبر نیست.
const POLL_TTL_MS = 30 * 60_000;
const MAX_POLLS = 500;
// محدودیت واتساپ برای متن سؤال و گزینه‌ها
const MAX_QUESTION_LENGTH = 250;
const MAX_OPTION_LENGTH = 100;

interface StoredPoll {
  jid: string;
  /** sha256 هر گزینه به ترتیب -- رأی رمزشده همین هش رو برمی‌گردونه */
  hashes: string[];
  secret: Uint8Array;
  /** jid خود اکانت (شماره و LID) -- برای رمزگشایی یکی از این‌ها لازمه */
  creatorJids: string[];
  createdAt: number;
}

export type PollVote =
  /** پیام رأی نیست */
  | { kind: 'none' }
  /** رأیه ولی به نظرسنجی‌ای که ما نفرستادیم یا منقضی شده (یا رأی پس گرفته شده) */
  | { kind: 'ignored' }
  | { kind: 'vote'; pollId: string; jid: string; index: number };

/**
 * نظرسنجی واتساپ به‌جای دکمه: دکمه‌های واقعی فقط در API رسمی بیزینس هست و
 * فرستادنش از اکانت معمولی (Baileys) ریسک بن داره؛ نظرسنجی امکان عادی همه‌ی
 * کاربرهاست و راننده با یک لمس جواب می‌ده.
 *
 * Baileys 7 رأی‌ها رو خودش رمزگشایی نمی‌کنه (کدش کامنت شده) -- کلید هر
 * نظرسنجی (messageSecret) اینجا نگه داشته می‌شه و رأی با decryptPollVote باز می‌شه.
 * فقط در جواب ویس خود کاربر فرستاده می‌شه، نه بی‌مقدمه.
 */
@Injectable()
export class WhatsappPollService {
  private readonly logger = new Logger(WhatsappPollService.name);
  private readonly polls = new Map<string, StoredPoll>();

  get enabled(): boolean {
    return process.env.WHATSAPP_POLLS !== 'off';
  }

  /** نظرسنجی تک‌انتخابی می‌فرسته و شناسه‌اش رو برمی‌گردونه؛ اگه نشد null (فراخواننده متن شماره‌دار بفرسته). */
  async send(sock: WASocket, jid: string, question: string, options: string[]): Promise<string | null> {
    if (!this.enabled) return null;
    const values = options.map((option) => truncate(option, MAX_OPTION_LENGTH));
    // واتساپ گزینه‌ی تکراری قبول نمی‌کنه و رأی با هش متن گزینه شناخته می‌شه.
    if (new Set(values).size !== values.length) return null;

    try {
      const { jidNormalizedUser } = await import('@whiskeysockets/baileys');
      const sent = await sock.sendMessage(jid, {
        poll: { name: truncate(question, MAX_QUESTION_LENGTH), values, selectableCount: 1 },
      });
      const id = sent?.key.id;
      const secret = sent?.message?.messageContextInfo?.messageSecret;
      if (!id || !secret) return null;

      const me = sock.user;
      const creatorJids = unique([me?.id, (me as { lid?: string } | undefined)?.lid].map((j) => (j ? jidNormalizedUser(j) : undefined)));
      this.prune();
      this.polls.set(id, { jid, hashes: values.map(hashOption), secret, creatorJids, createdAt: Date.now() });
      return id;
    } catch (error) {
      this.logger.warn(`Sending WhatsApp poll failed (${jid}): ${(error as Error).message}`);
      return null;
    }
  }

  /** اگه پیام رأی به یکی از نظرسنجی‌های ما باشه، گزینه‌ی انتخاب‌شده (از ۰) رو برمی‌گردونه. */
  async readVote(msg: WAMessage): Promise<PollVote> {
    const update = msg.message?.pollUpdateMessage;
    if (!update) return { kind: 'none' };

    const pollId = update.pollCreationMessageKey?.id;
    const poll = pollId ? this.polls.get(pollId) : undefined;
    if (!pollId || !poll || Date.now() - poll.createdAt > POLL_TTL_MS || !update.vote) return { kind: 'ignored' };

    const { decryptPollVote, jidNormalizedUser } = await import('@whiskeysockets/baileys');
    const key = msg.key as WAMessage['key'] & { remoteJidAlt?: string; participantAlt?: string };
    // رأی با jid رأی‌دهنده همون‌طور که واتساپ می‌شناسه رمز شده -- شماره یا LID.
    const voters = unique([key.participant, key.participantAlt, key.remoteJid, key.remoteJidAlt].map((j) => (j ? jidNormalizedUser(j) : undefined)));

    for (const pollCreatorJid of poll.creatorJids) {
      for (const voterJid of voters) {
        try {
          const vote = decryptPollVote(update.vote, { pollCreatorJid, pollMsgId: pollId, pollEncKey: poll.secret, voterJid });
          const selected = vote.selectedOptions?.[0];
          // رأی پس گرفته شد (گزینه‌ای انتخاب نیست)
          if (!selected) return { kind: 'ignored' };
          const index = poll.hashes.indexOf(Buffer.from(selected).toString('hex'));
          if (index < 0) return { kind: 'ignored' };
          // هر نظرسنجی یک بار مصرفه -- عوض کردن رأی بعداً کاری انجام نمی‌ده.
          this.polls.delete(pollId);
          return { kind: 'vote', pollId, jid: poll.jid, index };
        } catch {
          // کلید این ترکیب jidها نبود -- ترکیب بعدی
        }
      }
    }
    this.logger.warn(`Could not decrypt WhatsApp poll vote ${pollId} (voters: ${voters.join(', ')})`);
    return { kind: 'ignored' };
  }

  /** نظرسنجی دیگه جواب نمی‌گیره (کاربر با متن یا ویس جواب داد). */
  forget(pollId: string | undefined): void {
    if (pollId) this.polls.delete(pollId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, poll] of this.polls) if (now - poll.createdAt > POLL_TTL_MS) this.polls.delete(id);
    while (this.polls.size >= MAX_POLLS) this.polls.delete(this.polls.keys().next().value!);
  }
}

const hashOption = (option: string) => createHash('sha256').update(Buffer.from(option)).digest('hex');
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const unique = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];
