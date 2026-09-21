import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramCallback } from '../../domain/constants/telegram/TelegramCallback';
import { SubscriptionOrder } from '../../domain/entities/subscription/SubscriptionOrder';
import { SubscriptionPlan } from '../../domain/entities/subscription/SubscriptionPlan';
import {
  AccountType,
  CommunicationProvider,
  SubscriptionOrderStatus,
} from '../../domain/enums/subscription';
import { TelegramSessionState } from '../../domain/enums/telegram';
import { ISubscriptionOrderRepository } from '../../domain/repositories/subscription/ISubscriptionOrderRepository';
import { ISubscriptionPlanRepository } from '../../domain/repositories/subscription/ISubscriptionPlanRepository';
import { PaymentReceiptService } from '../subscription/paymentreceipt.service';
import { SubscriptionOrderService } from '../subscription/subscriptionorder.service';
import { SubscriptionPlanService } from '../subscription/subscriptionPlan.service';
import { TelegramService } from './telegram.service';
import { TelegramAccountHandler } from './telegramAccountHandler.service';
import { TelegramIdentityService } from './telegramIdentity.service';
import { TelegramMenuService } from './telegramMenu.service';
import { TelegramMessagesService } from './telegramMessages.service';
import { TelegramSessionService } from './telegramSession.service';

describe('Telegram purchase navigation', () => {
  const telegramUserId = '42';
  const chatId = '42';
  let bot: TelegramBot;
  let sendMessage: jest.Mock;
  let sessions: TelegramSessionService;
  let orders: jest.Mocked<ISubscriptionOrderRepository>;
  let plans: jest.Mocked<ISubscriptionPlanRepository>;
  let identity: { touch: jest.Mock; findByTelegramUserId: jest.Mock };
  let handler: TelegramAccountHandler;
  let service: TelegramService;
  let menu: TelegramMenuService;

  const order = (status: SubscriptionOrderStatus): SubscriptionOrder =>
    Object.assign(new SubscriptionOrder(), {
      id: 'order-1',
      provider: CommunicationProvider.Telegram,
      providerUserId: telegramUserId,
      accountType: AccountType.Driver,
      subscriptionPlanId: 'plan-1',
      amount: '150000',
      currency: 'IRR',
      phoneNumber: '09123456789',
      status,
    });

  const message = (text: string): TelegramBot.Message => ({
    message_id: 1,
    date: 0,
    from: { id: 42, is_bot: false, first_name: 'Driver' },
    chat: { id: 42, type: 'private' },
    text,
  });

  beforeEach(() => {
    sendMessage = jest.fn().mockResolvedValue({});
    bot = {
      sendMessage,
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
    } as unknown as TelegramBot;
    sessions = new TelegramSessionService();
    orders = {
      findById: jest.fn(),
      findByIdWithPlan: jest.fn(),
      findPendingByProviderUser: jest.fn().mockResolvedValue(null),
      findLatestByProviderUser: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    plans = {
      findById: jest.fn().mockResolvedValue(Object.assign(new SubscriptionPlan(), {
        id: 'plan-1', title: 'Monthly', price: '150000', accountType: AccountType.Driver,
      })),
      findActiveByAccountType: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    identity = {
      touch: jest.fn().mockResolvedValue({}),
      findByTelegramUserId: jest.fn().mockResolvedValue(null),
    };
    const messages = { get: (key: string) => key } as TelegramMessagesService;
    const config = new ConfigService({
      SUBSCRIPTION_CARD_NUMBER: 'test-card',
      SUBSCRIPTION_CARD_OWNER: 'test-owner',
    });
    menu = new TelegramMenuService(identity as unknown as TelegramIdentityService, messages);
    handler = new TelegramAccountHandler(
      config,
      new SubscriptionPlanService(plans),
      new SubscriptionOrderService(plans, orders),
      {} as PaymentReceiptService,
      sessions,
      menu,
      messages,
    );
    service = new TelegramService(
      config, handler, identity as unknown as TelegramIdentityService, menu, sessions, messages,
    );
    Object.assign(service, { bot });
  });

  it.each([
    TelegramSessionState.SelectingAccountType,
    TelegramSessionState.SelectingPlan,
    TelegramSessionState.WaitingForPhone,
    TelegramSessionState.WaitingForReceipt,
    TelegramSessionState.UnderReview,
  ])('/start opens the main menu and preserves %s', async (state) => {
    const session = { state, accountType: AccountType.Driver, subscriptionPlanId: 'plan-1' };
    sessions.set(telegramUserId, session);

    await service['handleMessage'](message('/start'));

    expect(sessions.get(telegramUserId)).toEqual(session);
    expect(sendMessage).toHaveBeenCalledWith(chatId, 'menu.main.title', expect.any(Object));
    expect(orders.findPendingByProviderUser).not.toHaveBeenCalled();
  });

  it('removes the phone keyboard when navigating to the main menu', async () => {
    sessions.set(telegramUserId, { state: TelegramSessionState.WaitingForPhone });
    await service['handleMessage'](message('menu.common.mainMenu'));
    expect(sendMessage).toHaveBeenCalledWith(chatId, 'account.continueFromMenu', {
      reply_markup: { remove_keyboard: true },
    });
  });

  it('resets unrelated state on /start', async () => {
    sessions.set(telegramUserId, {
      state: TelegramSessionState.WaitingForAgentSelection, pendingOperationId: 'operation',
    });
    await service['handleMessage'](message('/start'));
    expect(sessions.get(telegramUserId)).toEqual({ state: TelegramSessionState.Idle });
  });

  it('main-menu callbacks preserve the purchase', async () => {
    sessions.set(telegramUserId, { state: TelegramSessionState.SelectingPlan, accountType: AccountType.Driver });
    await service['handleCallbackQuery']({
      id: 'callback', from: message('').from!, chat_instance: 'chat',
      message: message(''), data: TelegramCallback.MainMenu,
    });
    expect(sessions.get(telegramUserId)?.state).toBe(TelegramSessionState.SelectingPlan);
  });

  it.each(['/payment', '/payment@transport_bot'])('routes %s to tracking', async (command) => {
    await service['handleMessage'](message(command));
    expect(sendMessage).toHaveBeenCalledWith(chatId, 'payment.noPurchase', expect.any(Object));
    expect(orders.findPendingByProviderUser).toHaveBeenCalledWith(CommunicationProvider.Telegram, telegramUserId);
    expect(orders.findLatestByProviderUser).toHaveBeenCalledWith(CommunicationProvider.Telegram, telegramUserId);
  });

  it('routes the Persian tracking button to the same flow', async () => {
    await service['handleCallbackQuery']({
      id: 'callback', from: message('').from!, chat_instance: 'chat',
      message: message(''), data: TelegramCallback.PaymentStatus,
    });
    expect(sendMessage).toHaveBeenCalledWith(chatId, 'payment.noPurchase', expect.any(Object));
  });

  it.each([null, 'DRIVER', 'COMPANY', 'BROKER', 'OTHER'])(
    'omits the tracking button from the main menu for %s', async (role) => {
      identity.findByTelegramUserId.mockResolvedValue(role
        ? { user: { userRoles: [{ role: { name: role } }] } } : null);
      await menu.showMainMenu(bot, chatId, telegramUserId);
      const buttons = sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat();
      expect(buttons).not.toContainEqual(expect.objectContaining({ callback_data: TelegramCallback.PaymentStatus }));
    },
  );

  it('restores a saved unpaid order after the in-memory session is lost', async () => {
    orders.findPendingByProviderUser.mockResolvedValue(order(SubscriptionOrderStatus.WaitingForReceipt));
    await handler.showPurchaseStatus(bot, chatId, telegramUserId);
    expect(sessions.get(telegramUserId)).toMatchObject({ state: TelegramSessionState.WaitingForReceipt, orderId: 'order-1' });
    expect(sendMessage).toHaveBeenCalledWith(chatId, 'payment.information', expect.any(Object));
    expect(orders.save).not.toHaveBeenCalled();
    expect(orders.findLatestByProviderUser).not.toHaveBeenCalled();
  });

  it.each([SubscriptionOrderStatus.ReceiptSubmitted, SubscriptionOrderStatus.UnderReview])(
    'shows review status for %s without asking for another receipt', async (status) => {
      orders.findPendingByProviderUser.mockResolvedValue(order(status));
      await handler.showPurchaseStatus(bot, chatId, telegramUserId);
      expect(sendMessage).toHaveBeenCalledWith(chatId, 'payment.reviewStatus', expect.any(Object));
      expect(sendMessage).not.toHaveBeenCalledWith(chatId, 'payment.information', expect.any(Object));
      expect(sessions.get(telegramUserId)?.state).toBe(TelegramSessionState.UnderReview);
      expect(orders.save).not.toHaveBeenCalled();
    },
  );

  it.each([
    [SubscriptionOrderStatus.Approved, 'payment.approved'],
    [SubscriptionOrderStatus.Rejected, 'payment.rejected'],
    [SubscriptionOrderStatus.Cancelled, 'payment.cancelled'],
  ])('reads the final %s status instead of trusting stale session state', async (status, key) => {
    sessions.set(telegramUserId, { state: TelegramSessionState.UnderReview, orderId: 'order-1' });
    orders.findLatestByProviderUser.mockResolvedValue(order(status as SubscriptionOrderStatus));
    await handler.showPurchaseStatus(bot, chatId, telegramUserId);
    expect(sendMessage).toHaveBeenCalledWith(chatId, key, expect.any(Object));
    expect(sessions.get(telegramUserId)?.state).toBe(TelegramSessionState.Idle);
  });

  it.each([
    [TelegramSessionState.SelectingAccountType, 'account.selectType'],
    [TelegramSessionState.SelectingPlan, 'account.noActivePlan'],
    [TelegramSessionState.WaitingForPhone, 'account.planSelected'],
  ])('continues %s without creating an order', async (state, key) => {
    sessions.set(telegramUserId, {
      state: state as TelegramSessionState, accountType: AccountType.Driver, subscriptionPlanId: 'plan-1',
    });
    await handler.showPurchaseStatus(bot, chatId, telegramUserId);
    expect(sendMessage).toHaveBeenCalledWith(chatId, key, expect.any(Object));
    expect(orders.save).not.toHaveBeenCalled();
  });

  it('keeps session data when the status lookup fails', async () => {
    const session = { state: TelegramSessionState.WaitingForReceipt, orderId: 'order-1' };
    sessions.set(telegramUserId, session);
    orders.findPendingByProviderUser.mockRejectedValue(new Error('Database unavailable'));
    const log = jest.spyOn(handler['logger'], 'error').mockImplementation(() => undefined);
    try {
      await handler.showPurchaseStatus(bot, chatId, telegramUserId);
      expect(sessions.get(telegramUserId)).toEqual(session);
      expect(sendMessage).toHaveBeenCalledWith(chatId, 'errors.loadPaymentStatusFailed', expect.any(Object));
      expect(sendMessage).not.toHaveBeenCalledWith(chatId, 'payment.noPurchase', expect.any(Object));
    } finally {
      log.mockRestore();
    }
  });
});
