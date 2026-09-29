import { Injectable } from '@nestjs/common';

import { AgentSource, FunctionCallResultType } from './types';

/** کانالی که پیشرفت و نتیجه agent را علاوه بر socket به کاربر می‌رساند. */
export interface AgentChannelRelay {
  sendCurrentTool(userId: string, data: { currentOp?: string }): Promise<void>;
  sendToolResult(userId: string, data: FunctionCallResultType): Promise<void>;
}

/**
 * AgentGateway نتیجه را به کانالی می‌دهد که درخواست از آن آمده. کانال‌ها خودشان
 * اینجا ثبت می‌شوند تا gateway به سرویس هر پیام‌رسان وابسته نباشد.
 */
@Injectable()
export class AgentChannelRelays {
  private readonly relays = new Map<AgentSource, AgentChannelRelay>();

  register(source: AgentSource, relay: AgentChannelRelay): void {
    this.relays.set(source, relay);
  }

  get(source: AgentSource): AgentChannelRelay | undefined {
    return this.relays.get(source);
  }
}
