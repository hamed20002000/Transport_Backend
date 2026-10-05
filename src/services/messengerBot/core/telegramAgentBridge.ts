import { Injectable } from '@nestjs/common';

/** همه callback_dataهای agent با این پیشوند شروع می‌شوند. */
export const AGENT_CALLBACK_PREFIX = 'agent:';

export interface TelegramAgentContext {
  chatId: string;
  externalUserId: string;
  /** کاربر سامانه؛ فقط بعد از بررسی اتصال حساب و اشتراک فعال ساخته می‌شود. */
  userId: string;
}

export interface TelegramAgentVoice {
  fileId: string;
  fileSize?: number;
  duration: number;
}

export interface TelegramAgentHandler {
  handleText(ctx: TelegramAgentContext, text: string): Promise<void>;
  handleVoice(ctx: TelegramAgentContext, voice: TelegramAgentVoice): Promise<void>;
  handleCallback(ctx: TelegramAgentContext, data: string, messageId?: number): Promise<void>;
}

/**
 * agent در AgentModule است و خودش MessengerBotModule را import می‌کند؛ برای
 * اینکه ربات بدون وابستگی چرخشی پیام‌ها را به agent بدهد، agent هنگام
 * راه‌اندازی خودش را اینجا ثبت می‌کند. اگر ثبت نشده باشد ربات مثل قبل
 * پیام «به‌زودی» می‌دهد.
 */
@Injectable()
export class TelegramAgentBridge {
  private handler?: TelegramAgentHandler;

  register(handler: TelegramAgentHandler): void {
    this.handler = handler;
  }

  get current(): TelegramAgentHandler | undefined {
    return this.handler;
  }
}
