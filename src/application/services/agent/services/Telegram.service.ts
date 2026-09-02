import { Injectable, OnModuleInit, Logger, Inject, forwardRef } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TelegramLink } from '../entities/TelegramLink';
import { ConversationSession } from '../entities/ConversationSession';
import { FunctionCallService } from './functioncall.service';
import { SpeechToTextService } from './Speechtotext.service';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { TelegramLinkCode } from '../entities/TelegramLinkCode';
import { UserService } from '../../user/user.service';
import { UUID } from 'node:crypto';
import { AuthService } from 'src/auth/auth.service';

const execAsync = promisify(exec);

@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);
    private bot: TelegramBot;

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @Inject(forwardRef(() => FunctionCallService))
        private readonly functionCallService: FunctionCallService,
        private readonly speechToTextService: SpeechToTextService,
        private readonly userService: UserService,
        private readonly authService: AuthService
    ) { }

    // متن‌های تشخیص‌داده‌شده از صدا که هنوز منتظر تایید کاربرن
    private pendingTranscriptions = new Map<string, string>();

    // شناسه‌ی پیام‌هایی که اخیراً پردازش شدن -- برای جلوگیری از پردازش
    // دوباره‌ی همون پیام (مثلاً اگه به‌خاطر قطعی/تاخیر شبکه، تلگرام
    // دوباره deliverش کنه -- که دقیقاً همون چیزی بود که با پینگ بالا
    // (بیش از ۱ ثانیه) بهش برخوردیم)
    private processedMessageIds = new Set<number>();

    onModuleInit() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            this.logger.warn('TELEGRAM_BOT_TOKEN تنظیم نشده -- بات تلگرام غیرفعاله.');
            return;
        }

        this.bot = new TelegramBot(token, { polling: true });

        this.bot.on('message', (msg) => {
            void this.handleMessage(msg).catch((error) => {
                this.logger.error(`Telegram message handler failed: ${error?.message || error}`);
            });
        });
        this.bot.on('callback_query', (query) => {
            void this.handleCallbackQuery(query).catch((error) => {
                this.logger.error(`Telegram callback handler failed: ${error?.message || error}`);
            });
        });

        // برای دیدن دقیق چندبار و چرا اتصال polling قطع می‌شه
        this.bot.on('polling_error', (error: any) => {
            this.logger.error(`Polling hatası: ${error.code} - ${error.message}`);
        });

        this.logger.log('بات تلگرام فعال شد.');
    }

    /**
     * برای AgentGateway لازمه تا بفهمه یک userId، chatId تلگرام‌شده رو
     * داره یا نه -- تا نتیجه رو هم از این طریق بفرسته.
     */
    private buildProgressBar(current: number, total: number, barLength: number = 10): string {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const filledCount = total > 0 ? Math.round((current / total) * barLength) : 0;
        const bar = "█".repeat(filledCount) + "░".repeat(barLength - filledCount);
        return `[${bar}] ${percent}%`;
    }

    private activeProgressMessages = new Map<string, number>();

    private async safeSendMessage(
        chatId: string,
        text: string,
        options?: TelegramBot.SendMessageOptions,
    ): Promise<TelegramBot.Message | null> {
        if (!this.bot) return null;

        try {
            return await this.bot.sendMessage(chatId, text, options);
        } catch (error: any) {
            this.logger.error(
                `Telegram sendMessage failed for chatId=${chatId}: ${error?.message || error}`,
            );
            return null;
        }
    }

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
                const sent = await this.safeSendMessage(chatId, text);
                if (sent) {
                    this.activeProgressMessages.set(chatId, sent.message_id);
                }
            }
        } else {
            const sent = await this.safeSendMessage(chatId, text);
            if (sent) {
                this.activeProgressMessages.set(chatId, sent.message_id);
            }
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

    async getChatIdForUsername(userid: string): Promise<string | null> {
        const link = await this.dataSource.getRepository(TelegramLink).findOne({
            where: { Userid: userid },
        });
        return link ? link.ChatId : null;
    }

    async sendMessageToChat(chatId: string, text: string): Promise<void> {
        await this.safeSendMessage(chatId, text);
    }

    private async handleMessage(msg: TelegramBot.Message): Promise<void> {
        // اگه این message_id رو قبلاً پردازش کردیم، دوباره پردازشش نکن --
        // این دقیقاً همون محافظتیه که به‌خاطر پینگ بالا (redelivery
        // احتمالی از سمت تلگرام) لازم شد
        if (this.processedMessageIds.has(msg.message_id)) {
            this.logger.debug(`پیام تکراری نادیده گرفته شد: ${msg.message_id}`);
            return;
        }
        this.processedMessageIds.add(msg.message_id);

        // جلوی رشد بی‌نهایت حافظه رو بگیر -- فقط ۵۰۰ تای آخر رو نگه دار
        if (this.processedMessageIds.size > 500) {
            const first = this.processedMessageIds.values().next().value;
            this.processedMessageIds.delete(first);
        }

        const chatId = msg.chat.id.toString();
        const text = msg.text?.trim();

        // // اگه یک chatId مشخص توی .env تعریف شده، فقط همون یکی رو
        // // پردازش کن -- بقیه رو کاملاً نادیده بگیر (بدون هیچ پاسخی)
        // const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
        // if (allowedChatId && chatId !== allowedChatId) {
        //     this.logger.debug(`پیام از chatId غیرمجاز نادیده گرفته شد: ${chatId}`);
        //     return;
        // }

        if (msg.text == "/start") {
            await this.safeSendMessage(chatId, 'Merhaba! Ben Setash Agent botuyum. Hesabınızı bağlamak için şunu yazın: /link kullaniciadiniz parolanız');
            return;
        }

        // پیام صوتی -- باید اول تایید بگیریم، مستقیم اجرا نمی‌کنیم
        if (msg.voice) {
            await this.handleVoiceMessage(msg.voice.file_id, chatId);
            return;
        }

        if (!text) return;

        // دستور ساده‌ی ربط حساب: /link username password
        if (text.startsWith('/link ')) {
            const parts = text.replace('/link ', '').trim().split(/\s+/);
            const [username, password] = parts;
            await this.handleLinkCommand(chatId, username, password, msg.message_id);
            return;
        }

        // متن تایپ‌شده -- چون خود کاربر مستقیم نوشته، نیازی به تایید
        // اضافه (که مخصوص خطای تشخیص صوته) نداره
        await this.processPromptText(chatId, text);
    }

    /**
       * پیام صوتی رو به متن تبدیل می‌کنه، ولی به‌جای اجرای مستقیم، اول
       * متن تشخیص‌داده‌شده رو با دو دکمه (تایید/رد) به کاربر نشون می‌ده --
       * چون تشخیص صوت ممکنه اشتباه باشه و اجرای عملیات اشتباه خطرناکه.
       */
    private async handleVoiceMessage(fileId: string, chatId: string): Promise<void> {
        try {
            await this.bot.sendMessage(chatId, '🎤 Ses işleniyor...');

            // دانلود و خروجی رو کاملاً توی دو پوشه‌ی جدا نگه می‌داریم --
            // تا الگوریتم نام‌گذاری داخلی node-telegram-bot-api هیچ‌وقت
            // با فایل‌های خروجی خودمون برخورد نکنه
            const downloadDir = join(process.cwd(), 'uploads', 'telegram-voice', 'downloads');
            const convertedDir = join(process.cwd(), 'uploads', 'telegram-voice', 'converted');
            await mkdir(downloadDir, { recursive: true });
            await mkdir(convertedDir, { recursive: true });

            const oggPath = await this.bot.downloadFile(fileId, downloadDir);
            this.logger.debug(`>>> oggPath: ${oggPath}`);

            // اسم خروجی رو با یک شناسه‌ی تصادفی می‌سازیم (نه بر اساس
            // اسم ورودی) تا کاملاً مستقل و بدون ابهام باشه
            const wavPath = join(convertedDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
            this.logger.debug(`>>> wavPath: ${wavPath}`);

            await execAsync(`ffmpeg -y -i "${oggPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`);

            const text = await this.speechToTextService.transcribeFile(wavPath);

            if (!text) {
                await this.bot.sendMessage(chatId, 'Ses metne dönüştürülemedi. Lütfen tekrar deneyin.');
                return;
            }

            // متن رو نگه می‌داریم تا وقتی کاربر تایید کرد، همینو اجرا کنیم
            this.pendingTranscriptions.set(chatId, text);

            await this.bot.sendMessage(
                chatId,
                `🎤 Şunu anladım:\n"${text}"\n\nBu doğru mu?`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ Evet, çalıştır', callback_data: 'confirm_voice' },
                            { text: '❌ Hayır, iptal et', callback_data: 'cancel_voice' },
                        ]],
                    },
                }
            );
        } catch (error: any) {
            this.logger.error(`Ses işleme hatası: ${error.message}`);
            // AggregateError چند تا خطای تودرتو داره -- این‌ها رو هم جدا چاپ کن
            if (error.errors) {
                error.errors.forEach((e: any, i: number) => {
                    this.logger.error(`  خطای داخلی [${i}]: ${e.message} (code: ${e.code})`);
                });
            }
            this.logger.error(error.stack);
            await this.bot.sendMessage(chatId, 'Ses işlenirken bir hata oluştu.');
        }
    }


    /**
     * وقتی کاربر روی یکی از دکمه‌های تایید/رد کلیک می‌کنه، این هندلر
     * صدا زده می‌شه (نه handleMessage -- تلگرام این‌ها رو جدا می‌فرسته)
     */
    private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
        const chatId = query.message?.chat.id.toString();
        if (!chatId || !query.message) return;

        // به تلگرام بگو کلیک دریافت شد (وگرنه دکمه توی UI "در حال بارگذاری" می‌مونه)
        await this.bot.answerCallbackQuery(query.id);

        if (query.data === 'confirm_voice') {
            const text = this.pendingTranscriptions.get(chatId);
            this.pendingTranscriptions.delete(chatId);

            if (!text) {
                await this.bot.editMessageText('Onay süresi dolmuş. Lütfen tekrar ses gönderin.', {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
                return;
            }

            await this.bot.editMessageText(`✅ Onaylandı: "${text}"`, {
                chat_id: chatId,
                message_id: query.message.message_id,
            });

            await this.processPromptText(chatId, text);
        } else if (query.data === 'cancel_voice') {
            this.pendingTranscriptions.delete(chatId);
            await this.bot.editMessageText('❌ İptal edildi. Lütfen tekrar deneyin.', {
                chat_id: chatId,
                message_id: query.message.message_id,
            });
        }
    }

    /**
     * منطق مشترک "این متن رو به‌عنوان یک prompt واقعی پردازش کن" --
     * چه از تایپ مستقیم بیاد، چه از تایید یک متن صوتی
     */
    private async processPromptText(chatId: string, text: string): Promise<void> {
        const link = await this.dataSource.getRepository(TelegramLink).findOne({
            where: { ChatId: chatId },
        });

        if (!link) {
            await this.safeSendMessage(
                chatId,
                'Hesabınızı bağlamak için önce şunu yazın: /link kullaniciadiniz parolanız'
            );
            return;
        }

        const REVERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
        const sinceLastVerified = Date.now() - new Date(link.LastVerifiedAt).getTime();

        if (sinceLastVerified > REVERIFY_WINDOW_MS) {
            await this.safeSendMessage(
                chatId,
                'Güvenlik nedeniyle yeniden doğrulama gerekiyor. Lütfen şunu yazın: /link kullaniciadiniz parolanız'
            );
            return;
        }

        const { sessionId } = await this.functionCallService.createNewSession(link.Userid);
        const user = await this.userService.getByUserId(link.Userid);

        const fakeReq = {
            user: {
                userid: user.id,
                username: user.username
            }
        };

        await this.safeSendMessage(chatId, '⏳ İşleniyor...');

        try {
            this.functionCallService.source="telegram";
            await this.functionCallService.RunFunctionCalling(text, fakeReq, [], sessionId);
        } catch (error: any) {
            await this.safeSendMessage(chatId, `Hata: ${error?.message || 'Bilinmeyen bir hata oluştu.'}`);
        }
    }

    /**
     * فقط از طریق پنل وب (با JWT معتبر) صدا زده می‌شه -- پس username
     * قابل‌اعتماده (از توکن میاد، نه از ورودی دستی کاربر).
     */
    async generateLinkCode(username: string): Promise<{ code: string }> {
        const code = Math.floor(100000 + Math.random() * 900000).toString(); // ۶ رقمی

        await this.dataSource.getRepository(TelegramLinkCode).save({
            Code: code,
            Username: username,
            Used: false,
        });

        return { code };
    }

    private async handleLinkCommand(
        chatId: string,
        username: string,
        password: string,
        messageId: number
    ): Promise<void> {
        if (!username || !password) {
            await this.safeSendMessage(chatId, 'Kullanım: /link kullaniciadi parola');
            return;
        }

        // اعتبارسنجی واقعی -- باید همون منطقی که برای لاگین وب استفاده
        // می‌شه (بررسی هش رمز عبور) رو اینجا هم صدا بزنیم
        const isValid = await this.authService.validateUser({ password, username });


        // پیام حاوی رمز عبور رو فوراً پاک کن -- چه موفق چه ناموفق --
        // تا حداقل توی UI چت باقی نمونه
        try {
            await this.bot.deleteMessage(chatId, messageId);
        } catch (error) {
            // اگه پاک کردن شکست خورد (مثلاً پیام قدیمی‌تر از محدودیت زمانی
            // تلگرامه)، جلوی ادامه‌ی کار رو نگیر
        }

        if (!isValid) {
            await this.safeSendMessage(chatId, 'Kullanıcı adı veya parola hatalı.');
            return;
        }

        // اگه از قبل یک لینک برای این chat وجود داره، همونو آپدیت کن
        // (نه یک ردیف جدید بساز) -- @UpdateDateColumn خودکار
        // LastVerifiedAt رو به الان تنظیم می‌کنه
        const repo = this.dataSource.getRepository(TelegramLink);
        const existing = await repo.findOne({ where: { ChatId: chatId } });

        if (existing) {
            existing.Userid = isValid.user.id;
            await repo.save(existing);
        } else {
            await repo.save({ Userid: isValid.user.id, ChatId: chatId });
        }

        await this.safeSendMessage(chatId, `Hesabınız "${username}" olarak doğrulandı.`);
    }
}