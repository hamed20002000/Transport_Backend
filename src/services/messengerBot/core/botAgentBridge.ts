import { Injectable } from '@nestjs/common';

/** همه callback_dataهای agent با این پیشوند شروع می‌شوند. */
export const AGENT_CALLBACK_PREFIX = 'agent:';

export interface BotAgentContext {
  chatId: string;
  externalUserId: string;
  /** کاربر سامانه؛ فقط بعد از بررسی اتصال حساب و اشتراک فعال ساخته می‌شود. */
  userId: string;
}

export interface BotAgentVoice {
  fileId: string;
  fileSize?: number;
  duration: number;
}

export interface BotAgentHandler {
  handleText(ctx: BotAgentContext, text: string): Promise<void>;
  handleVoice(ctx: BotAgentContext, voice: BotAgentVoice): Promise<void>;
  handleCallback(ctx: BotAgentContext, data: string, messageId?: number): Promise<void>;
  /** agent منتظر جواب کاربر است؛ متن او جواب agent است، نه انتخاب منو. */
  isAwaitingAnswer(ctx: BotAgentContext): boolean;
}

/**
 * agent در AgentModule است و خودش MessengerBotModule را import می‌کند؛ برای
 * اینکه ربات بدون وابستگی چرخشی پیام‌ها را به agent بدهد، agent هنگام
 * راه‌اندازی خودش را اینجا ثبت می‌کند. اگر ثبت نشده باشد ربات مثل قبل
 * پیام «به‌زودی» می‌دهد.
 */
@Injectable()
export class BotAgentBridge {
  private handler?: BotAgentHandler;

  register(handler: BotAgentHandler): void {
    this.handler = handler;
  }

  get current(): BotAgentHandler | undefined {
    return this.handler;
  }
}
