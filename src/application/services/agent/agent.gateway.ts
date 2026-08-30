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

@WebSocketGateway({
  cors: { origin: ['http://localhost:5173'], credentials: false },
  path: '/socket.io',
  transports:  ['websocket', 'polling'],
  namespace:"/agent"
})
export class AgentGateway {
  @WebSocketServer()
  server: Server;
  constructor(
    private readonly cancellation:CancellationService
  ) {}


  async sendToolResult(userId: string, data: FunctionCallResultType) {
  this.server
    .to(`user:${userId}`)
    .emit('agent-tool-result', data);
}

  async sendCurrentTool(userId: string, data: any) {
  this.server
    .to(`user:${userId}`)
    .emit('agent-current-tool', data);
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

 



  handleConnection(client: any) {
    const userId = client.handshake.query.userId;

    if (userId && typeof userId === 'string') {
      client.join(`user:${userId}`);
    }
    
  }

  handleDisconnect(client: any) {
  }
}
