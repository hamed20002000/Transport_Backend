import { MarketAction } from '../../market/marketBot.service';
import { BotSubscriptionService } from './botSubscription.service';
import { Injectable } from '@nestjs/common';
import { BotKeyboardService } from './botKeyboard';

import { BotIdentityService } from './botIdentity.service';
import { BotMessagesService } from './botMessages.service';

import {
  BotCallback,
  BotCallbackBuilder,
} from '../../../domain/constants/bot/BotCallback';

import { AccountType } from 'src/domain/enums/subscription';
import { AccountVerificationService } from '../../company/accountVerification.service';

@Injectable()
export class BotMenuService {
  constructor(
    private readonly botIdentityService:
      BotIdentityService,

    private readonly messages:
      BotMessagesService,
    private readonly keyboard: BotKeyboardService,
    private readonly botSubscriptionService: BotSubscriptionService,
    private readonly verification: AccountVerificationService,
  ) {}

  /*
   * =====================================================
   * Main Menu
   * =====================================================
   */

  /** نقش کاربر معلوم نیست (منوی اصلی، پایان خرید، ...): اگر حساب وصل نیست منوی مهمان. */
  async showMenuForUser(
    chatId: string,
    externalUserId: string,
  ): Promise<void> {
    const roles = await this.botIdentityService.getMenuRoles(externalUserId);
    if (roles === null) {
      await this.showGuestMenu(chatId);
      return;
    }

    await this.showMenuForRoles(chatId, externalUserId, roles);
  }

  /** منوی نقش کاربری که حسابش وصل است و نقش‌هایش را صدازننده از قبل دارد. */
  async showMenuForRoles(
    chatId: string,
    externalUserId: string,
    roles: string[],
  ): Promise<void> {
    if (!(await this.ensureActiveSubscription(chatId, externalUserId))) return;
    if (await this.sendIfUnverified(chatId, externalUserId)) return;

    /*
     * Driver
     */

    if (
      roles.includes('DRIVER')
    ) {
      await this.showDriverMenu(
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
        chatId,
      );

      return;
    }

    /*
     * Factory: only sending loads to the transport companies that invited it
     */

    if (roles.includes('FACTORY')) {
      await this.showFactoryMenu(chatId);

      return;
    }

    /*
     * Registered User
     * without supported role
     */

    await this.showRegisteredMenu(
      chatId,
    );
  }

  /**
   * سابسکریپشن کاربر را بررسی می کند
   * برای این کار ابتدا بررسی میکند اصلا سابسکرپشن فعال هست یا نه
   * کاربر سابسکرپشن دارد؟
   * اگر نقش دارد منوی انتخاب سابسکرپشن نمایش داده میشود
   * اگر برای اون نقش  سابسکریپشن تعریف نشده باشدپیغام فعلا سابسکرپشن ندارد نمایش داده میشود به همراه دوتا دکمه دیگه
   * @param chatId 
   * @param externalUserId 
   * @returns 
   */

  /**
   * شرکت یا کارخانه‌ای که خودش ثبت‌نام کرده و هنوز تأیید شرکت مادر را ندارد: به‌جای منو وضعیتش و راه ادامه
   * (پروفایل و درخواست بررسی در پنل وب). true یعنی همین پیام فرستاده شد و منو نباید باز شود.
   */
  async sendIfUnverified(chatId: string, externalUserId: string): Promise<boolean> {
    const userId = await this.botIdentityService.getUserId(externalUserId);
    const notice = userId ? await this.verification.messengerNotice(userId) : null;
    if (!notice) return false;
    await this.keyboard.sendMainMenu(chatId, notice, {
      reply_markup: { inline_keyboard: [[{ text: this.messages.get('menu.common.support'), callback_data: BotCallback.Support }]] },
    });
    return true;
  }

  //#region ---------------------------- ایا کاربر سابسکرپشن دارد؟ -----------------------
      ensureActiveSubscription(chatId: string, externalUserId: string): Promise<boolean> {
        return this.botSubscriptionService.ensureActiveSubscription(chatId, externalUserId);
      }
  //#endregion ----------------------------------------------------------------------------

  /*
   * =====================================================
   * Guest
   * =====================================================
   */

  private async showGuestMenu(
    chatId: string,
  ): Promise<void> {
    await this.keyboard.sendMainMenu(chatId,

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
                  BotCallback.BuyAccount,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.main.renewSubscription',
                  ),

                callback_data:
                  BotCallback.RenewSubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.main.support',
                  ),

                callback_data:
                  BotCallback.Support,
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
   * BotAccountHandler می‌تواند
   * این متد را صدا بزند.
   */

  async showAccountTypes(
    chatId: string,
  ): Promise<void> {
    await this.keyboard.sendMessage(chatId,

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
                  BotCallbackBuilder.accountType(
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
                  BotCallbackBuilder.accountType(
                    AccountType.Company,
                  ),
              },
            ],

            // Broker is not offered for now.

            [
              {
                text:
                  this.messages.get(
                    'menu.common.back',
                  ),

                callback_data:
                  BotCallback.MainMenu,
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
    chatId: string,
  ): Promise<void> {
    await this.keyboard.sendMainMenu(chatId,

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
                  BotCallback.DriverSearchLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.loadRequests',
                  ),

                callback_data:
                  BotCallback.DriverLoadRequests,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.activeTrip',
                  ),

                callback_data:
                  BotCallback.DriverActiveTrip,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.returnLoads',
                  ),

                callback_data:
                  BotCallback.DriverReturnLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.sendLocation',
                  ),

                callback_data:
                  BotCallback.DriverSendLocation,
              },
              {
                text:
                  this.messages.get(
                    'menu.driver.myLocation',
                  ),

                callback_data:
                  BotCallback.DriverMyLocation,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.marketPrices',
                  ),

                callback_data:
                  MarketAction.Show,
              },
              {
                text:
                  this.messages.get(
                    'menu.driver.borders',
                  ),

                callback_data:
                  BotCallback.Borders,
              },
            ],

            [{ text: this.messages.get('menu.driver.cargoDisplay'), callback_data: BotCallback.CargoDisplay }],

            [
              {
                text:
                  this.messages.get(
                    'menu.driver.subscription',
                  ),

                callback_data:
                  BotCallback.MySubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  BotCallback.Support,
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
    chatId: string,
  ): Promise<void> {
    await this.keyboard.sendMainMenu(chatId,

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
                  BotCallback.CompanyCreateLoad,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.loads',
                  ),

                callback_data:
                  BotCallback.CompanyLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.driverRequests',
                  ),

                callback_data:
                  BotCallback.CompanyDriverRequests,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.activeTrips',
                  ),

                callback_data:
                  BotCallback.CompanyActiveTrips,
              },
            ],

            [{ text: this.messages.get('menu.company.profile'), callback_data: BotCallback.CompanyProfile }],

            [{ text: this.messages.get('menu.company.features'), callback_data: BotCallback.CompanyFeatures }],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.channels',
                  ),

                callback_data:
                  BotCallback.CompanyChannels,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.marketPrices',
                  ),

                callback_data:
                  MarketAction.Show,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.company.subscription',
                  ),

                callback_data:
                  BotCallback.MySubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  BotCallback.Support,
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
    chatId: string,
  ): Promise<void> {
    await this.keyboard.sendMainMenu(chatId,

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
                  BotCallback.BrokerSearchLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.broker.loads',
                  ),

                callback_data:
                  BotCallback.BrokerLoads,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.broker.subscription',
                  ),

                callback_data:
                  BotCallback.MySubscription,
              },
            ],

            [
              {
                text:
                  this.messages.get(
                    'menu.common.support',
                  ),

                callback_data:
                  BotCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Factory
   * =====================================================
   */

  private async showFactoryMenu(chatId: string): Promise<void> {
    await this.keyboard.sendMainMenu(chatId, this.messages.get('menu.factory.title'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: this.messages.get('menu.factory.createLoad'), callback_data: BotCallback.FactoryCreateLoad }],
          [{ text: this.messages.get('menu.factory.excel'), callback_data: BotCallback.FactoryExcel }],
          [{ text: this.messages.get('menu.factory.loads'), callback_data: BotCallback.FactoryLoads }],
          [{ text: this.messages.get('menu.common.support'), callback_data: BotCallback.Support }],
        ],
      },
    });
  }

  /*
   * =====================================================
   * Registered User Without Supported Role
   * =====================================================
   */

  private async showRegisteredMenu(
    chatId: string,
  ): Promise<void> {
    await this.keyboard.sendMainMenu(chatId,

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
                  BotCallback.Support,
              },
            ],
          ],
        },
      },
    );
  }
}
