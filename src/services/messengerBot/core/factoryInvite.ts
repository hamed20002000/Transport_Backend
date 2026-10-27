import { Injectable } from '@nestjs/common';

/**
 * Invite codes in a message: «/start <code>» from a Telegram/Bale link, or the code itself sent to any messenger.
 * A transport company invites a factory with «inv_…» and a driver with «drv_…»; the parent company invites a
 * transport company with «cmp_…».
 * All are personal: the inviter made the account with the invited number beforehand, so the code only signs that
 * number in.
 */
export const INVITE_CODE_PREFIX = 'inv_';
export const COMPANY_INVITE_PREFIX = 'cmp_';
export const DRIVER_INVITE_PREFIX = 'drv_';
const INVITE_CODE = /\b(inv|cmp|drv)_([A-Za-z0-9_-]{16,64})/;
const KINDS = { inv: 'factory', cmp: 'company', drv: 'driver' } as const;

export interface MessengerInvite {
  kind: (typeof KINDS)[keyof typeof KINDS];
  token: string;
}

export function inviteIn(text: string | null | undefined): MessengerInvite | null {
  const match = text?.match(INVITE_CODE);
  if (!match) return null;
  return { kind: KINDS[match[1] as keyof typeof KINDS], token: match[2] };
}

export type FactoryInviteResult =
  /** companyName: the transport company that invited the factory */
  | { status: 'joined'; companyName: string }
  /** revoked, or no such link */
  | { status: 'invalid' }
  /** the number given is not the one the company invited */
  | { status: 'otherNumber' };

/** companyName: the transport company that invited the driver (its loads now reach the driver) */
export type DriverInviteResult = FactoryInviteResult;

export type CompanyInviteResult =
  /** welcome: the menus, their prices and how to buy them */
  | { status: 'joined'; parentName: string; welcome: string }
  | { status: 'invalid' }
  /** the number given is not the one the parent company invited */
  | { status: 'otherNumber' };

export interface FactoryInviteHandler {
  /** the account behind this number is the invited factory (welcome) or not (another number) */
  factoryWelcome(userId: string, token: string): Promise<FactoryInviteResult>;
  /** the account behind this number is the invited transport company (welcome, with the menus) or not */
  companyWelcome(userId: string, token: string): Promise<CompanyInviteResult>;
  /** the account behind this number is the invited driver (welcome) or not */
  driverWelcome(userId: string, token: string): Promise<DriverInviteResult>;
}

/**
 * FactoryService and CompanyInviteService live in modules that depend on MessengerBotModule; the bots reach them
 * through this bridge, which FactoryDialog fills at start-up (like BotAgentBridge).
 */
@Injectable()
export class FactoryInviteBridge {
  private handler?: FactoryInviteHandler;

  register(handler: FactoryInviteHandler): void {
    this.handler = handler;
  }

  factoryWelcome(userId: string, token: string): Promise<FactoryInviteResult> {
    return this.handler ? this.handler.factoryWelcome(userId, token) : Promise.resolve({ status: 'invalid' });
  }

  companyWelcome(userId: string, token: string): Promise<CompanyInviteResult> {
    return this.handler ? this.handler.companyWelcome(userId, token) : Promise.resolve({ status: 'invalid' });
  }

  driverWelcome(userId: string, token: string): Promise<DriverInviteResult> {
    return this.handler ? this.handler.driverWelcome(userId, token) : Promise.resolve({ status: 'invalid' });
  }
}
