export enum TelegramSessionState {
  Idle = 'IDLE',

  SelectingAccountType = 'SELECTING_ACCOUNT_TYPE',

  SelectingPlan = 'SELECTING_PLAN',

  WaitingForPhone = 'WAITING_FOR_PHONE',

  WaitingForReceipt = 'WAITING_FOR_RECEIPT',

  UnderReview = 'UNDER_REVIEW',

  WaitingForAgentConfirmation = 'WAITING_FOR_AGENT_CONFIRMATION',

  WaitingForAgentSelection = 'WAITING_FOR_AGENT_SELECTION',
}