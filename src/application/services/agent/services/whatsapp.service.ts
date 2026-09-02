import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import { join } from 'node:path';

@Injectable()
export class WhatsappService implements OnModuleInit {
    private readonly logger = new Logger(WhatsappService.name);
    private sock: ReturnType<typeof makeWASocket>;

    async onModuleInit() {
        await this.connect();
    }

    private async connect() {
        // اطلاعات نشست (session) اینجا ذخیره می‌شه -- بعد از اولین
        // اسکن QR، دفعات بعدی نیازی به اسکن دوباره نیست
        const authDir = join(process.cwd(), 'whatsapp-auth');
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        this.sock = makeWASocket({
            auth: state,
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.logger.log('QR کد زیر رو با گوشیت اسکن کن:');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect =
                    (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

                this.logger.warn(`اتصال قطع شد. وصل‌شدن دوباره: ${shouldReconnect}`);

                if (shouldReconnect) {
                    this.connect();
                }
            } else if (connection === 'open') {
                this.logger.log('به واتساپ وصل شد.');
            }
        });

        // فقط echo -- هنوز هیچ AI ای درگیر نیست
        this.sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            const from = msg.key.remoteJid;

            if (text && from) {
                this.logger.debug(`پیام دریافت شد از ${from}: ${text}`);
                await this.sock.sendMessage(from, { text: `دریافت شد: ${text}` });
            }
        });
    }
}