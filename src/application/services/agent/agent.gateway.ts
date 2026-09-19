import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Server } from 'socket.io';
import { FunctionCallResultType } from './types';
import { CancellationService } from './services/cancellation.service';
import { Socket } from 'socket.io';
import { TelegramService } from './services/Telegram.service';
// جدید: WhatsappService رو هم import کنید (مسیر واقعی پروژه‌تون)
import { WhatsappService } from './services/whatsapp.service';
import { forwardRef, Inject } from '@nestjs/common';
import { FunctionCallService } from './services/functioncall.service';

@WebSocketGateway({
  cors: { origin: ['http://localhost:5173'], credentials: false },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  namespace: "/agent"
})
export class AgentGateway {
  @WebSocketServer()
  server!: Server;
  constructor(
    private readonly cancellation: CancellationService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    // جدید: WhatsappService رو هم inject کنید (همون الگوی forwardRef تلگرام)
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    @Inject(forwardRef(() => FunctionCallService))
    private readonly functionCallService: FunctionCallService,
  ) { }

  // حذف شد: totalSegments/currentSegment -- شمارش دقیق مراحل (چه مشترک،
  // چه per-user) با ترکیب generator pause/resume و چندین segment، به‌سادگی
  // قابل پیش‌بینی دقیق نیست (تعداد واقعی sendCurrentTool صداها بسته به
  // این‌که چندتا segment، هر کدوم generator بودن یا نه، و چندبار
  // pause/resume شدن فرق می‌کنه -- هیچ عدد ثابتی درست نیست). به‌جاش:
  // مراحل میانی یک نوار متحرک/نمایشی نشون می‌دن (خودِ TelegramService/
  // WhatsappService داخلی مدیریتش می‌کنن، امن در برابر هر تعداد
  // فراخوانی)، و فقط پیام نهایی یک نوار ۱۰۰٪ واقعی می‌گیره.


  async sendToolResult(userId: string, data: FunctionCallResultType) {
    this.server
      .to(`user:${userId}`)
      .emit('agent-tool-result', data);

    if (this.functionCallService.source == "telegram") {
      // جدید: حالت انتخاب از لیست/تایید -- باید قبل از شاخه‌ی success/error چک بشه
      if (data.result === "confirm_required" && (data as any).data?.data) {
        await this.telegramService.sendSelectionRequest(
          userId,
          (data as any).data.message || data.message,
          (data as any).data.data,
        );
        return;
      }

      // جدید: delete_* گونه تاییدهای ساده (بدون options) -- قبلاً به‌اشتباه
      // به شاخه‌ی success/error می‌رفت و با ❌ نمایش داده می‌شد
      if (data.result === "confirm_required") {
        await this.telegramService.sendYesNoConfirmation(userId, data.message as any);
        return;
      }

      const chatId = await this.telegramService.getChatIdForUsername(userId);
      if (chatId) {
        const text = data.result === "success"
          ? `✅ ${data.message}`
          : `❌ ${data.message}`;

        // جدید: فقط وقتی این واقعاً آخرین segment این دستوره (نه یک قدم
        // میانی توی یک دستور چندبخشی)، finalizeProgress صدا زده می‌شه --
        // که هم پیام رو نهایی می‌کنه (با نوار ۱۰۰٪ واقعی) هم
        // activeProgressMessages رو پاک می‌کنه. قدم‌های میانی فقط متن +
        // نوار متحرک (بدون درصد واقعی) می‌گیرن.
        if ((data as any).lastsegment) {
          await this.telegramService.finalizeProgress(chatId, `⏳ ${text}`);
        } else {
          await this.telegramService.sendOrUpdateProgress(chatId, `⏳ ${text}`);
        }

        //await this.telegramService.sendMessageToChat(chatId, text);
      }
    }

    // جدید: همون منطق تلگرام، برای واتساپ
    if (this.functionCallService.source == "whatsapp") {
      // جدید: حالت انتخاب از لیست/تایید (صفحه‌بندی‌شده) -- برای موقعی که options داره
      if (data.result === "confirm_required" && (data as any).data?.data) {
        await this.whatsappService.sendSelectionRequest(
          userId,
          (data as any).data.message || data.message,
          (data as any).data.data,
        );
        return;
      }

      // جدید: delete_* گونه تاییدهای ساده (بدون options) -- قبلاً به‌اشتباه
      // به شاخه‌ی success/error می‌رفت و با ❌ نمایش داده می‌شد
      if (data.result === "confirm_required") {
        await this.whatsappService.sendYesNoConfirmation(userId, data.message as any);
        return;
      }

      const jid = await this.whatsappService.getJidForUsername(userId);
      if (jid) {
        const text = data.result === "success"
          ? `✅ ${data.message}`
          : `❌ ${data.message}`;

        // جدید: همون فیکس تلگرام -- فقط موقع آخرین segment، finalizeProgress
        // صدا زده می‌شه (نوار ۱۰۰٪ واقعی)؛ قدم‌های میانی فقط نوار متحرک.
        if ((data as any).lastsegment) {
          await this.whatsappService.finalizeProgress(jid, `⏳ ${text}`);
        } else {
          await this.whatsappService.sendOrUpdateProgress(jid, `⏳ ${text}`);
        }
      }
    }


  }

  async sendCurrentTool(userId: string, data: any) {
    this.server
      .to(`user:${userId}`)
      .emit('agent-current-tool', data);
    if (this.functionCallService.source == "telegram") {
      const chatId = await this.telegramService.getChatIdForUsername(userId);
      if (chatId) {
        // این یک مرحله‌ی میانیه -- همون پیام رو ویرایش کن (نوار متحرک،
        // نه درصد واقعی)، نه یک پیام جدید بفرست
        await this.telegramService.sendOrUpdateProgress(chatId, `⏳ ${data.currentOp}`);
      }
    }

    // جدید: شاخه‌ی واتساپ
    if (this.functionCallService.source == "whatsapp") {
      const jid = await this.whatsappService.getJidForUsername(userId);
      if (jid) {
        await this.whatsappService.sendOrUpdateProgress(jid, `⏳ ${data.currentOp}`);
      }
    }

  }

  @SubscribeMessage('cancel-execution')
  handleCancel(@ConnectedSocket() client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      this.cancellation.cancel(userId);
    }
  }



  /**
  * پیام رو به همه‌ی کلاینت‌هایی که عضو یک domain خاصن (نه یک کاربر
  * مشخص) می‌فرسته -- این همون جایگزین "Pusher trigger" هست.
  */
  async broadcastDomainChange(domain: string, data: any) {
    this.server.to(`domain:${domain}`).emit('domain-changed', data);
  }

  /**
   * کلاینت وقتی وارد یک صفحه‌ی لیست می‌شه (مثلاً صفحه‌ی tender ها)،
   * این event رو می‌فرسته تا عضو اون اتاق بشه.
   */
  @SubscribeMessage('subscribe-domain')
  handleSubscribeDomain(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { domain: string }
  ) {
    client.join(`domain:${body.domain}`);
  }

  /**
* وقتی کاربر از اون صفحه خارج می‌شه، باید عضویتش رو لغو کنه --
* تا پیام‌های بی‌ربط بهش نرسه
*/
  @SubscribeMessage('unsubscribe-domain')
  handleUnsubscribeDomain(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { domain: string }
  ) {
    client.leave(`domain:${body.domain}`);
  }



  // این رو هم توی respond-to-pending-action موقت اضافه کن تا socket.id رو ببینیم:
  @SubscribeMessage('respond-to-pending-action')
  handleRespondToPendingAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { value: any, cancel: boolean }
  ) {
    console.log('[respond-to-pending-action] socket.id:', client.id, '| client.data:', client.data);

    const userId = client.data?.userId;
    if (!userId) return;

    void this.functionCallService.handleGeneratorResponse(userId, body.value, body.cancel);
  }

  handleConnection(client: any) {
    const userId = client.handshake.query.userId;

    if (userId && typeof userId === 'string') {
      client.join(`user:${userId}`);
      client.data.userId = userId;
    }
  }



  handleDisconnect(client: any) {
  }
}