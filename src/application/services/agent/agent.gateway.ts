import {
  ConnectedSocket,
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



  handleConnection(client: any) {
    const userId = client.handshake.query.userId;

    if (userId && typeof userId === 'string') {
      client.join(`user:${userId}`);
    }
    
  }

  handleDisconnect(client: any) {
  }
}
