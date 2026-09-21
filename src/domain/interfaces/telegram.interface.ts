import { AccountType } from "../enums/subscription";
import { TelegramSessionState } from "../enums/telegram";


export interface TelegramSession {
  state: TelegramSessionState;

  accountType?: AccountType;

  subscriptionPlanId?: string;

  orderId?: string;

  phoneNumber?: string;

  pendingOperationId?: string;

  pendingOptions?: TelegramPendingOption[];
}

export interface TelegramPendingOption {
  id: string;
  title: string;
}