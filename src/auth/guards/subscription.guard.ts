import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { SubscriptionAccessService } from 'src/services/subscription/subscriptionAccess.service';

/** The body of a 402: the web panels show the purchase page for this code. */
export const SUBSCRIPTION_REQUIRED_CODE = 'SUBSCRIPTION_REQUIRED';

/**
 * After JwtAuthGuard: lets the request through only while the user may work (SubscriptionAccessService: a
 * subscription, a driver's free period, or no subscription required). Otherwise 402, so nothing but buying
 * (the /api/subscription endpoints, which do not use this guard) works.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly access: SubscriptionAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest<{ user?: { userId?: string } }>().user?.userId;
    if (!userId) return true; // JwtAuthGuard has already turned away a request without a user
    const access = await this.access.check(userId);
    if (access.allowed) return true;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: SUBSCRIPTION_REQUIRED_CODE,
        message: access.isDriver ? 'دوره‌ی رایگان شما تمام شده است؛ برای ادامه اشتراک بخرید.' : 'برای ادامه اشتراک لازم است.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
