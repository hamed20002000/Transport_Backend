import { SubscriptionPlanController } from 'src/presentation/controllers/admin/subscription-plan.controller';
import { Subscription } from '../../domain/entities/subscription/Subscription';
import { SubscriptionRepository } from '../../infrastructure/repositories/subscription/subscription.repository';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SubscriptionPlan } from '../../domain/entities/subscription/SubscriptionPlan';
import { SubscriptionOrder } from '../../domain/entities/subscription/SubscriptionOrder';
import { PaymentReceipt } from '../../domain/entities/subscription/PaymentReceipt';

import { SubscriptionPlanRepository } from '../../infrastructure/repositories/subscription/subscriptionPlan.repository';
import { SubscriptionOrderRepository } from '../../infrastructure/repositories/subscription/subscriptionOrder.repository';
import { PaymentReceiptRepository } from '../../infrastructure/repositories/subscription/paymentReceipt.repository';

import { SubscriptionPlanService } from '../../services/subscription/subscriptionPlan.service';
import { SubscriptionOrderService } from 'src/services/subscription/subscriptionorder.service';
import { PaymentReceiptService } from 'src/services/subscription/paymentreceipt.service';
import { ReceiptAnalyzerService } from '../../services/subscription/receiptAnalyzer.service';

import {
  SUBSCRIPTION_REPOSITORY,
  SUBSCRIPTION_PLAN_REPOSITORY,
  SUBSCRIPTION_ORDER_REPOSITORY,
  PAYMENT_RECEIPT_REPOSITORY,
  RECEIPT_ANALYZER,
} from '../../domain/repositories/repository.tokens';

@Module({
  controllers: [SubscriptionPlanController],
  imports: [
    TypeOrmModule.forFeature([
      Subscription,
      SubscriptionPlan,
      SubscriptionOrder,
      PaymentReceipt,
    ]),
  ],

  providers: [
    SubscriptionRepository,
    { provide: SUBSCRIPTION_REPOSITORY, useExisting: SubscriptionRepository },
    SubscriptionPlanService,
    SubscriptionOrderService,
    PaymentReceiptService,

    SubscriptionPlanRepository,
    SubscriptionOrderRepository,
    PaymentReceiptRepository,

    ReceiptAnalyzerService,

    {
      provide: SUBSCRIPTION_PLAN_REPOSITORY,
      useExisting: SubscriptionPlanRepository,
    },

    {
      provide: SUBSCRIPTION_ORDER_REPOSITORY,
      useExisting: SubscriptionOrderRepository,
    },

    {
      provide: PAYMENT_RECEIPT_REPOSITORY,
      useExisting: PaymentReceiptRepository,
    },

    {
      provide: RECEIPT_ANALYZER,
      useExisting: ReceiptAnalyzerService,
    },
  ],

  exports: [
    SUBSCRIPTION_REPOSITORY,
    SubscriptionPlanService,
    SubscriptionOrderService,
    PaymentReceiptService,

    SUBSCRIPTION_PLAN_REPOSITORY,
    SUBSCRIPTION_ORDER_REPOSITORY,
    PAYMENT_RECEIPT_REPOSITORY,
    RECEIPT_ANALYZER,
  ],
})
export class SubscriptionModule {}