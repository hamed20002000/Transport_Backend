import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PaymentHistoryService } from 'src/services/subscription/paymentHistory.service';

type AuthRequest = { user: { userId: string } };

/**
 * «پرداخت‌ها» in every panel (driver, transport company, factory, broker): what the account paid and what became of it.
 * Without SubscriptionGuard, like buying: a user whose time is over still sees its payments.
 */
@Controller('api/account/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentHistoryService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.payments.list(request.user.userId);
  }
}
