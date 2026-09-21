import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomInt } from 'crypto';

import { User } from 'src/domain/entities/auth/User';
import { Role } from 'src/domain/entities/auth/Role';
import { UserRole } from 'src/domain/entities/auth/UserRole';

import { Subscription } from 'src/domain/entities/subscription/Subscription';
import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';
import { PaymentReceipt } from 'src/domain/entities/subscription/PaymentReceipt';
import { SubscriptionPlan } from 'src/domain/entities/subscription/SubscriptionPlan';

import { AccountType } from 'src/domain/enums/subscription';
import { SubscriptionStatus } from 'src/domain/enums/subscription';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { PaymentReceiptStatus } from 'src/domain/enums/subscription';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

import { PasswordService } from '../auth/password.service';

export interface AccountProvisioningResult {
  userId: string;

  username: string;

  temporaryPassword: string;

  subscriptionId: string;

  expireAt: Date;
}

@Injectable()
export class AccountProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
  ) {}

  async approveOrder(
    orderId: string,
    receiptId: string,
    adminUserId: string,
  ): Promise<AccountProvisioningResult> {
    return this.dataSource.transaction(
      async (
        manager: EntityManager,
      ): Promise<AccountProvisioningResult> => {
        /*
         * -------------------------------------------------
         * 1. Get and lock order
         * -------------------------------------------------
         */

        const order = await manager
          .getRepository(SubscriptionOrder)
          .createQueryBuilder('order')
          .setLock('pessimistic_write')
          .leftJoinAndSelect(
            'order.subscriptionPlan',
            'subscriptionPlan',
          )
          .where('order.id = :orderId', {
            orderId,
          })
          .getOne();

        if (!order) {
          throw new NotFoundException(
            'Subscription order not found',
          );
        }

        /*
         * -------------------------------------------------
         * 2. Check order status
         * -------------------------------------------------
         */

        if (
          order.status ===
          SubscriptionOrderStatus.Approved
        ) {
          throw new ConflictException(
            'Subscription order has already been approved',
          );
        }

        if (
          order.status ===
          SubscriptionOrderStatus.Cancelled
        ) {
          throw new BadRequestException(
            'Cancelled subscription order cannot be approved',
          );
        }

        /*
         * -------------------------------------------------
         * 3. Get receipt
         * -------------------------------------------------
         */

        const receipt = await manager.findOne(
          PaymentReceipt,
          {
            where: {
              id: receiptId,
            },
          },
        );

        if (!receipt) {
          throw new NotFoundException(
            'Payment receipt not found',
          );
        }

        /*
         * -------------------------------------------------
         * 4. Receipt must belong to this order
         * -------------------------------------------------
         */

        if (receipt.orderId !== order.id) {
          throw new BadRequestException(
            'Payment receipt does not belong to this subscription order',
          );
        }

        /*
         * -------------------------------------------------
         * 5. Check receipt status
         * -------------------------------------------------
         */

        if (
          receipt.status ===
          PaymentReceiptStatus.Rejected
        ) {
          throw new BadRequestException(
            'Rejected payment receipt cannot be approved',
          );
        }

        if (
          receipt.status ===
          PaymentReceiptStatus.Approved
        ) {
          throw new ConflictException(
            'Payment receipt has already been approved',
          );
        }

        /*
         * -------------------------------------------------
         * 6. Validate duplicate tracking code
         * -------------------------------------------------
         */

        if (receipt.trackingCode) {
          const duplicateReceipt =
            await manager
              .getRepository(PaymentReceipt)
              .createQueryBuilder('receipt')
              .where(
                'receipt.trackingCode = :trackingCode',
                {
                  trackingCode:
                    receipt.trackingCode,
                },
              )
              .andWhere(
                'receipt.id != :receiptId',
                {
                  receiptId: receipt.id,
                },
              )
              .andWhere(
                'receipt.status = :status',
                {
                  status:
                    PaymentReceiptStatus.Approved,
                },
              )
              .getOne();

          if (duplicateReceipt) {
            throw new ConflictException(
              'This payment tracking code has already been used',
            );
          }
        }

        /*
         * -------------------------------------------------
         * 7. Username = normalized phone number
         * -------------------------------------------------
         */

        const username = this.normalizePhone(
          order.phoneNumber,
        );

        /*
         * -------------------------------------------------
         * 8. Check existing user
         * -------------------------------------------------
         */

        const existingUser =
          await manager.findOne(User, {
            where: {
              username,
            },
          });

        if (existingUser) {
          throw new ConflictException(
            'A user with this phone number already exists',
          );
        }

        /*
         * -------------------------------------------------
         * 9. Determine role
         * -------------------------------------------------
         */

        const roleName = this.getRoleName(
          order.accountType,
        );

        const role = await manager.findOne(
          Role,
          {
            where: {
              name: roleName,
              recordStatus:
                RecordStatus.Active,
            },
          },
        );

        if (!role) {
          throw new NotFoundException(
            `Active role "${roleName}" not found`,
          );
        }

        /*
         * -------------------------------------------------
         * 10. Generate temporary password
         * -------------------------------------------------
         */

        const temporaryPassword =
          this.generateTemporaryPassword();

        const passwordHash =
          await this.passwordService.hashPassword(
            temporaryPassword,
          );

        /*
         * -------------------------------------------------
         * 11. Create User
         * -------------------------------------------------
         */

        const user = manager.create(User, {
          username,
          passwordHash,

          mobile: username,

          recordStatus:
            RecordStatus.Active,

          mustChangePassword: true,
        });

        const savedUser =
          await manager.save(User, user);

        /*
         * -------------------------------------------------
         * 12. Assign Role
         * -------------------------------------------------
         */

        const userRole = manager.create(
          UserRole,
          {
            userId: savedUser.id,
            roleId: role.id,
          },
        );

        await manager.save(
          UserRole,
          userRole,
        );

        /*
         * -------------------------------------------------
         * 13. Get subscription plan
         * -------------------------------------------------
         */

        let plan: SubscriptionPlan | null =
          order.subscriptionPlan ?? null;

        if (!plan) {
          plan = await manager.findOne(
            SubscriptionPlan,
            {
              where: {
                id: order.subscriptionPlanId,
              },
            },
          );
        }

        if (!plan) {
          throw new NotFoundException(
            'Subscription plan not found',
          );
        }

        /*
         * -------------------------------------------------
         * 14. Calculate subscription dates
         * -------------------------------------------------
         */

        const startAt = new Date();

        const expireAt =
          this.calculateExpireDate(
            startAt,
            plan.durationDays,
          );

        /*
         * -------------------------------------------------
         * 15. Create Subscription
         * -------------------------------------------------
         */

        const subscription =
          manager.create(
            Subscription,
            {
              userId: savedUser.id,

              subscriptionPlanId:
                plan.id,

              orderId: order.id,

              startAt,

              expireAt,

              status:
                SubscriptionStatus.Active,
            },
          );

        const savedSubscription =
          await manager.save(
            Subscription,
            subscription,
          );

        /*
         * -------------------------------------------------
         * 16. Approve receipt
         * -------------------------------------------------
         */

        const now = new Date();

        receipt.status =
          PaymentReceiptStatus.Approved;

        receipt.reviewedByUserId =
          adminUserId;

        receipt.reviewedAt = now;

        await manager.save(
          PaymentReceipt,
          receipt,
        );

        /*
         * -------------------------------------------------
         * 17. Approve order
         * -------------------------------------------------
         */

        order.status =
          SubscriptionOrderStatus.Approved;

        order.createdUserId =
          savedUser.id;

        order.approvedByUserId =
          adminUserId;

        order.approvedAt = now;

        await manager.save(
          SubscriptionOrder,
          order,
        );

        /*
         * -------------------------------------------------
         * 18. Return credentials
         *
         * IMPORTANT:
         * temporaryPassword is NEVER stored in database.
         * -------------------------------------------------
         */

        return {
          userId: savedUser.id,

          username:
            savedUser.username,

          temporaryPassword,

          subscriptionId:
            savedSubscription.id,

          expireAt:
            savedSubscription.expireAt,
        };
      },
    );
  }

  /*
   * =====================================================
   * Reject receipt
   * =====================================================
   */

  async rejectReceipt(
    orderId: string,
    receiptId: string,
    adminUserId: string,
    reason: string,
  ): Promise<void> {
    await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const order = await manager
          .getRepository(
            SubscriptionOrder,
          )
          .createQueryBuilder('order')
          .setLock('pessimistic_write')
          .where(
            'order.id = :orderId',
            {
              orderId,
            },
          )
          .getOne();

        if (!order) {
          throw new NotFoundException(
            'Subscription order not found',
          );
        }

        if (
          order.status ===
          SubscriptionOrderStatus.Approved
        ) {
          throw new BadRequestException(
            'Approved subscription order cannot be rejected',
          );
        }

        const receipt =
          await manager.findOne(
            PaymentReceipt,
            {
              where: {
                id: receiptId,
              },
            },
          );

        if (!receipt) {
          throw new NotFoundException(
            'Payment receipt not found',
          );
        }

        if (
          receipt.orderId !== order.id
        ) {
          throw new BadRequestException(
            'Payment receipt does not belong to this subscription order',
          );
        }

        const now = new Date();

        receipt.status =
          PaymentReceiptStatus.Rejected;

        receipt.reviewedByUserId =
          adminUserId;

        receipt.reviewedAt = now;

        receipt.reviewNote = reason;

        await manager.save(
          PaymentReceipt,
          receipt,
        );

        order.status =
          SubscriptionOrderStatus.Rejected;

        order.rejectedAt = now;

        order.rejectionReason = reason;

        await manager.save(
          SubscriptionOrder,
          order,
        );
      },
    );
  }

  /*
   * =====================================================
   * AccountType -> Role
   * =====================================================
   */

  private getRoleName(
    accountType: AccountType,
  ): string {
    switch (accountType) {
      case AccountType.Driver:
        return 'DRIVER';

      case AccountType.Company:
        return 'COMPANY';

      case AccountType.Broker:
        return 'BROKER';

      default: {
        const exhaustiveCheck: never =
          accountType;

        throw new BadRequestException(
          `Unsupported account type: ${String(
            exhaustiveCheck,
          )}`,
        );
      }
    }
  }

  /*
   * =====================================================
   * Phone normalization
   *
   * +989141234567 -> 09141234567
   * 989141234567  -> 09141234567
   * 09141234567   -> 09141234567
   * =====================================================
   */

  private normalizePhone(
    phone: string,
  ): string {
    let value = phone
      .trim()
      .replace(/\s+/g, '')
      .replace(/-/g, '');

    if (value.startsWith('+98')) {
      value = `0${value.substring(3)}`;
    } else if (
      value.startsWith('98')
    ) {
      value = `0${value.substring(2)}`;
    }

    return value;
  }

  /*
   * =====================================================
   * Temporary password
   *
   * 6-digit temporary password.
   * User must change it after first login.
   * =====================================================
   */

  private generateTemporaryPassword(): string {
    return randomInt(
      100000,
      1000000,
    ).toString();
  }

  /*
   * =====================================================
   * Subscription expiration
   * =====================================================
   */

  private calculateExpireDate(
    startAt: Date,
    durationDays: number,
  ): Date {
    const expireAt = new Date(
      startAt,
    );

    expireAt.setDate(
      expireAt.getDate() +
        durationDays,
    );

    return expireAt;
  }
}