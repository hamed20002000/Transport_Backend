import { Injectable, OnModuleInit, Logger, Inject, forwardRef } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TelegramLink } from '../entities/TelegramLink';
import { ConversationSession } from '../entities/ConversationSession';
import { FunctionCallService } from './functioncall.service';

@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);
    private bot: TelegramBot;

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @Inject(forwardRef(() => FunctionCallService))
        private readonly functionCallService: FunctionCallService,
    ) { }

    onModuleInit() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            this.logger.warn('TELEGRAM_BOT_TOKEN تنظیم نشده -- بات تلگرام غیرفعاله.');
            return;
        }

        this.bot = new TelegramBot(token, { polling: true });

        this.bot.on('message', (msg) => this.handleMessage(msg));

        this.logger.log('بات تلگرام فعال شد.');
    }

    /**
     * برای AgentGateway لازمه تا بفهمه یک userId، chatId تلگرام‌شده رو
     * داره یا نه -- تا نتیجه رو هم از این طریق بفرسته.
     */
    // نگه‌داری message_id فعلیِ "در حال پردازش" برای هر چت -- تا بتونیم
    // به‌جای فرستادن پیام جدید در هر مرحله، همون پیام رو ویرایش کنیم
    /**
     * یک نوار پیشرفت بصری با کاراکترهای یونیکد می‌سازه -- چون تلگرام
     * ویجت گرافیکی progressbar نداره، این ترفند متنی جایگزینش می‌شه.
     */
    private buildProgressBar(current: number, total: number, barLength: number = 10): string {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const filledCount = total > 0 ? Math.round((current / total) * barLength) : 0;
        const bar = "█".repeat(filledCount) + "░".repeat(barLength - filledCount);
        return `[${bar}] ${percent}%`;
    }

    private activeProgressMessages = new Map<string, number>();

    /**
     * حس progressbar می‌ده -- اگه از قبل یک پیام "در حال پردازش" برای
     * این چت داریم، همونو ویرایش می‌کنه؛ وگرنه یک پیام جدید می‌سازه.
     */
    async sendOrUpdateProgress(
        chatId: string,
        currentOp: string,
        currentSegment?: number,
        totalSegments?: number
    ): Promise<void> {
        if (!this.bot) return;

        const text = currentSegment && totalSegments
            ? `${this.buildProgressBar(currentSegment, totalSegments)}\n${currentOp}`
            : currentOp;

        const existingMessageId = this.activeProgressMessages.get(chatId);

        if (existingMessageId) {
            try {
                await this.bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: existingMessageId,
                });
            } catch (error) {
                const sent = await this.bot.sendMessage(chatId, text);
                this.activeProgressMessages.set(chatId, sent.message_id);
            }
        } else {
            const sent = await this.bot.sendMessage(chatId, text);
            this.activeProgressMessages.set(chatId, sent.message_id);
        }
    }

    /**
     * وقتی عملیات کامل تموم شد (نتیجه‌ی نهایی) -- همون پیام رو با
     * نتیجه‌ی نهایی ویرایش می‌کنه، و ردش رو از نقشه پاک می‌کنه چون
     * دیگه عملیات بعدی باید پیام "در حال پردازش" جدید خودش رو بسازه
     */
    async finalizeProgress(chatId: string, text: string): Promise<void> {
        await this.sendOrUpdateProgress(chatId, text);
        this.activeProgressMessages.delete(chatId);
    }

    async getChatIdForUsername(username: string): Promise<string | null> {
        const link = await this.dataSource.getRepository(TelegramLink).findOne({
            where: { Username: username },
        });
        return link ? link.ChatId : null;
    }

    async sendMessageToChat(chatId: string, text: string): Promise<void> {
        if (!this.bot) return;
        await this.bot.sendMessage(chatId, text);
    }

    private async handleMessage(msg: TelegramBot.Message): Promise<void> {
        const chatId = msg.chat.id.toString();
        const text = msg.text?.trim();

        if (!text) return;

        // اگه یک chatId مشخص توی .env تعریف شده، فقط همون یکی رو
        // پردازش کن -- بقیه رو کاملاً نادیده بگیر (بدون هیچ پاسخی)
        const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
        if (allowedChatId && chatId !== allowedChatId) {
            this.logger.debug(`پیام از chatId غیرمجاز نادیده گرفته شد: ${chatId}`);
            return;
        }

        // دستور ساده‌ی ربط حساب: /link نام‌کاربری
        if (text.startsWith('/link ')) {
            await this.handleLinkCommand(chatId, text.replace('/link ', '').trim());
            return;
        }

        // بررسی کن این chat به یک کاربر ربط داده شده یا نه
        const link = await this.dataSource.getRepository(TelegramLink).findOne({
            where: { ChatId: chatId },
        });

        if (!link) {
            await this.bot.sendMessage(
                chatId,
                'Hesabınızı bağlamak için önce şunu yazın: /link kullaniciadiniz'
            );
            return;
        }

        // یک session برای این چت پیدا/بساز (دقیقاً همون منطق createNewSession)
        const { sessionId } = await this.functionCallService.createNewSession(link.Username);

        // req.user رو دستی می‌سازیم -- چون تلگرام از JWT عبور نمی‌کنه
        const fakeReq = {
            user: {
                userid: link.Username, // اگه userid واقعی جای دیگه لازمه، باید از UserService بگیریش
                username: link.Username,
            },
        };

        await this.bot.sendMessage(chatId, '⏳ İşleniyor...');

        try {
            await this.functionCallService.RunFunctionCalling(text, fakeReq, [], sessionId);
        } catch (error: any) {
            await this.bot.sendMessage(chatId, `Hata: ${error?.message || 'Bilinmeyen bir hata oluştu.'}`);
        }
    }

    private async handleLinkCommand(chatId: string, username: string): Promise<void> {
        if (!username) {
            await this.bot.sendMessage(chatId, 'Kullanım: /link kullaniciadiniz');
            return;
        }

        // نکته‌ی امنیتی: این نسخه هیچ تاییدی (رمز عبور) نمی‌خواد --
        // فقط برای تست اولیه. قبل از production حتماً باید یک لایه‌ی
        // تایید (مثلاً یک کد یک‌بارمصرف) اضافه بشه.
        await this.dataSource.getRepository(TelegramLink).save({
            Username: username,
            ChatId: chatId,
        });

        await this.bot.sendMessage(chatId, `Hesabınız "${username}" olarak bağlandı.`);
    }
}