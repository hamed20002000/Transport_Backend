import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';

import { TelegramIdentityService } from './telegramIdentity.service';
import { TelegramMessagesService } from './telegramMessages.service';

import {
  TelegramCallback,
  TelegramCallbackBuilder,
} from '../../domain/constants/telegram/TelegramCallback';

import { AccountType } from 'src/domain/enums/subscription';

@Injectable()
export class TelegramMenuService {
  constructor(
    private readonly telegramIdentityService:
      TelegramIdentityService,

    private readonly messages:
      TelegramMessagesService,
  ) {}

  /*
   * =====================================================
   * Main Menu
   * =====================================================
   */

  async showMainMenu(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
  ): Promise<void> {
    const link =
      await this.telegramIdentityService.findByTelegramUserId(
        telegramUserId,
      );

    /*
     * Guest
     */

    if (!link?.user) {
      await this.showGuestMenu(
        bot,
        chatId,
      );

      return;
    }

    /*
     * Roles
     */

    const roles =
      link.user.userRoles
        ?.filter(
          userRole =>
            userRole.role != null,
        )
        .map(
          userRole =>
            userRole.role.name,
        ) ?? [];

    /*
     * Driver
     */

    if (
      roles.includes('DRIVER')
    ) {
      await this.showDriverMenu(
        bot,
        chatId,
      );

      return;
    }

    /*
     * Company
     */

    if (
      roles.includes('COMPANY') ||
      roles.includes(
        'COMPANY_ADMIN',
      )
    ) {
      await this.showCompanyMenu(
        bot,
        chatId,
      );

      return;
    }

    /*
     * Broker
     */

    if (
      roles.includes('BROKER')
    ) {
      await this.showBrokerMenu(
        bot,
        chatId,
      );

      return;
    }

    /*
     * Registered User
     * without supported role
     */

    await this.showRegisteredMenu(
      bot,
      chatId,
    );
  }

  /*
   * =====================================================
   * Guest
   * =====================================================
   */

  private async showGuestMenu(
    bot: TelegramBot,
    chatId: string,
  ): Promise<void> {
    await bot.sendMessage(
      chatId,

      this.messages.get(
        'menu.main.title',
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  this.messages.get(
                    'menu.main.buyAccount',
                  ),

                callback_data:
                  TelegramCallback.BuyAccount,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.main.renewSubscription',
                  ),

                callback_data:
                  TelegramCallback.RenewSubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.main.support',
                  ),

                callback_data:
                  TelegramCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Account Types
   * =====================================================
   *
   * این منو مربوط به خرید اکانت است.
   *
   * TelegramAccountHandler می‌تواند
   * این متد را صدا بزند.
   */

  async showAccountTypes(
    bot: TelegramBot,
    chatId: string,
  ): Promise<void> {
    await bot.sendMessage(
      chatId,

      this.messages.get(
        'account.selectType',
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  this.messages.get(
                    'account.driver',
                  ),

                callback_data:
                  TelegramCallbackBuilder.accountType(
                    AccountType.Driver,
                  ),
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'account.company',
                  ),

                callback_data:
                  TelegramCallbackBuilder.accountType(
                    AccountType.Company,
                  ),
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'account.broker',
                  ),

                callback_data:
                  TelegramCallbackBuilder.accountType(
                    AccountType.Broker,
                  ),
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.back',
                  ),

                callback_data:
                  TelegramCallback.MainMenu,
              },
            ],
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Driver
   * =====================================================
   */

  private async showDriverMenu(
    bot: TelegramBot,
    chatId: string,
  ): Promise<void> {
    await bot.sendMessage(
      chatId,

      this.messages.get(
        'menu.driver.title',
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  this.messages.get(
                    'menu.driver.searchLoads',
                  ),

                callback_data:
                  TelegramCallback.DriverSearchLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.loadRequests',
                  ),

                callback_data:
                  TelegramCallback.DriverLoadRequests,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.activeTrip',
                  ),

                callback_data:
                  TelegramCallback.DriverActiveTrip,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.returnLoads',
                  ),

                callback_data:
                  TelegramCallback.DriverReturnLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.subscription',
                  ),

                callback_data:
                  TelegramCallback.MySubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  TelegramCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Company
   * =====================================================
   */

  private async showCompanyMenu(
    bot: TelegramBot,
    chatId: string,
  ): Promise<void> {
    await bot.sendMessage(
      chatId,

      this.messages.get(
        'menu.company.title',
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  this.messages.get(
                    'menu.company.createLoad',
                  ),

                callback_data:
                  TelegramCallback.CompanyCreateLoad,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.loads',
                  ),

                callback_data:
                  TelegramCallback.CompanyLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.driverRequests',
                  ),

                callback_data:
                  TelegramCallback.CompanyDriverRequests,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.activeTrips',
                  ),

                callback_data:
                  TelegramCallback.CompanyActiveTrips,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.subscription',
                  ),

                callback_data:
                  TelegramCallback.MySubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  TelegramCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Broker
   * =====================================================
   */

  private async showBrokerMenu(
    bot: TelegramBot,
    chatId: string,
  ): Promise<void> {
    await bot.sendMessage(
      chatId,

      this.messages.get(
        'menu.broker.title',
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  this.messages.get(
                    'menu.broker.searchLoads',
                  ),

                callback_data:
                  TelegramCallback.BrokerSearchLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.broker.loads',
                  ),

                callback_data:
                  TelegramCallback.BrokerLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.broker.drivers',
                  ),

                callback_data:
                  TelegramCallback.BrokerDrivers,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.broker.subscription',
                  ),

                callback_data:
                  TelegramCallback.MySubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  TelegramCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Registered User Without Supported Role
   * =====================================================
   */

  private async showRegisteredMenu(
    bot: TelegramBot,
    chatId: string,
  ): Promise<void> {
    await bot.sendMessage(
      chatId,

      this.messages.get(
        'menu.registered.noSupportedRole',
      ),

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  TelegramCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }
}