import { AccountType } from "../enums/subscription";
import { BotSessionState } from "../enums/botSession";


export interface BotSession {
  state: BotSessionState;

  accountType?: AccountType;

  subscriptionPlanId?: string;

  orderId?: string;

  phoneNumber?: string;

  pendingOperationId?: string;

  pendingOptions?: BotPendingOption[];

  /** Epoch ms; when set, the session expires at this fixed time instead of sliding. */
  expiresAt?: number;
}

export interface BotPendingOption {
  id: string;
  title: string;
}