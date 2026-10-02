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
// جدید: WhatsappService رو هم import کنید (مسیر واقعی پروژه‌تون)
import { WhatsappService } from './services/whatsapp.service';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { FunctionCallService } from './services/functioncall.service';
import { AgentChannelRelay, AgentChannelRelays } from './agentChannelRelays';

@WebSocketGateway({
  cors: { origin: ['http://localhost:5173'], credentials: false },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  namespace: "/agent"
})
export class AgentGateway {
  private readonly logger = new Logger(AgentGateway.name);

  @WebSocketServer()
  server!: Server;
  constructor(
    private readonly jwtService: JwtService,
    private readonly relays: AgentChannelRelays,
    private readonly cancellation: CancellationService,
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
  // مراحل میانی یک نوار متحرک/نمایشی نشون می‌دن (خودِ MessengerBotService/
  // WhatsappService داخلی مدیریتش می‌کنن، امن در برابر هر تعداد
  // فراخوانی)، و فقط پیام نهایی یک نوار ۱۰۰٪ واقعی می‌گیره.


  async sendToolResult(userId: string, data: FunctionCallResultType) {
    this.server
      .to(`user:${userId}`)
      .emit('agent-tool-result', data);

    await this.relay(userId, relay => relay.sendToolResult(userId, data));

    // جدید: همون منطق تلگرام، برای واتساپ
    if (this.functionCallService.getSource(userId) === "whatsapp") {
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
    await this.relay(userId, relay => relay.sendCurrentTool(userId, data));

    // جدید: شاخه‌ی واتساپ
    if (this.functionCallService.getSource(userId) === "whatsapp") {
      const jid = await this.whatsappService.getJidForUsername(userId);
      if (jid) {
        await this.whatsappService.sendOrUpdateProgress(jid, `⏳ ${data.currentOp}`);
      }
    }

  }

  /**
   * کانال‌های ثبت‌شده در AgentChannelRelays (فعلاً تلگرام). خطای پیام‌رسان
   * نباید اجرای agent را بشکند؛ نتیجه در هر حال از socket هم رفته است.
   */
  private async relay(userId: string, send: (relay: AgentChannelRelay) => Promise<void>): Promise<void> {
    const relay = this.relays.get(this.functionCallService.getSource(userId));
    if (!relay) return;
    try {
      await send(relay);
    } catch (error) {
      this.logger.error(`Agent relay failed for ${userId}: ${(error as Error).message}`);
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



  @SubscribeMessage('respond-to-pending-action')
  handleRespondToPendingAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { value: any, cancel: boolean }
  ) {
    const userId = client.data?.userId;
    if (!userId) return;

    void this.functionCallService.handleGeneratorResponse(userId, body.value, body.cancel, 'web');
  }

  /**
   * کاربر از روی JWT شناخته می‌شود، نه از query، تا کسی نتواند با فرستادن
   * userId دیگری نتایج agent او را بگیرد یا به‌جایش تأیید/لغو بفرستد.
   * کلاینت: io(`${API_URL}/agent`, { path: '/socket.io', auth: { token } })
   */
  async handleConnection(client: Socket) {
    const userId = await this.authenticate(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    await client.join(`user:${userId}`);
  }

  private async authenticate(client: Socket): Promise<string | null> {
    const header = client.handshake.headers.authorization;
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return payload.isActive === false ? null : payload.userId ?? null;
    } catch (error) {
      this.logger.debug(`Agent socket rejected: ${(error as Error).message}`);
      return null;
    }
  }



  handleDisconnect(client: any) {
  }
}