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
  server: Server;
  constructor(
    private readonly cancellation: CancellationService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FunctionCallService))
    private readonly functionCallService: FunctionCallService
  ) { }


  totalSegments = 4;
  currentSegment = 0;


  async sendToolResult(userId: string, data: FunctionCallResultType) {
    this.server
      .to(`user:${userId}`)
      .emit('agent-tool-result', data);

    if (this.functionCallService.source == "telegram") {
      const chatId = await this.telegramService.getChatIdForUsername(userId);
      if (chatId) {
        const text = data.result === "success"
          ? `✅ ${data.message}`
          : `❌ ${data.message}`;
        await this.telegramService.sendOrUpdateProgress(chatId, `⏳ ${text}`, ++this.currentSegment, this.totalSegments);

        //await this.telegramService.sendMessageToChat(chatId, text);
        this.currentSegment = 0;
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
        // این یک مرحله‌ی میانیه -- همون پیام رو ویرایش کن (progressbar)،
        // نه یک پیام جدید بفرست
        await this.telegramService.sendOrUpdateProgress(chatId, `⏳ ${data.currentOp}`, ++this.currentSegment, this.totalSegments);
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


  @SubscribeMessage('respond-to-pending-action')
handleRespondToPendingAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { value: any }
) {
    const userId = client.data?.userId;
    if (!userId) return;

    // fire-and-forget -- نتیجه از طریق همون کانال سوکت (sendToolResult/
    // sendCurrentTool) به کاربر برمی‌گرده، نیازی به منتظرماندن اینجا نیست
    void this.functionCallService.handleGeneratorResponse(userId, body.value);
}






  handleConnection(client: any) {
    const userId = client.handshake.query.userId;

    if (userId && typeof userId === 'string') {
      client.join(`user:${userId}`);
    }

  }

  handleDisconnect(client: any) {
  }
}
