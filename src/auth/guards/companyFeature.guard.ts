import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { COMPANY_FEATURE_TITLES, CompanyFeature } from 'src/domain/enums/companyFeature';
import { CompanyFeatureService, isCompanyRole } from 'src/services/company/companyFeature.service';

/** The body of a 402 for a menu the company has not bought: the panel shows that menu's purchase page. */
export const COMPANY_FEATURE_REQUIRED_CODE = 'COMPANY_FEATURE_REQUIRED';

const COMPANY_FEATURE_KEY = 'companyFeature';

/** The menu (CompanyFeature) this endpoint belongs to; checked by CompanyFeatureGuard. */
export const RequireCompanyFeature = (feature: CompanyFeature) => SetMetadata(COMPANY_FEATURE_KEY, feature);

/**
 * After JwtAuthGuard: a transport company reaches an endpoint of a paid menu only while it has that menu
 * (CompanyFeatureService). Other roles pass, since the same endpoints serve drivers too and the controller
 * checks the role itself.
 */
@Injectable()
export class CompanyFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: CompanyFeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<CompanyFeature | undefined>(COMPANY_FEATURE_KEY, [context.getHandler(), context.getClass()]);
    if (!feature) return true;
    const user = context.switchToHttp().getRequest<{ user?: { userId?: string; roles?: string[] } }>().user;
    if (!user?.userId || !isCompanyRole(user.roles)) return true;
    if (await this.features.hasFeature(user.userId, feature)) return true;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: COMPANY_FEATURE_REQUIRED_CODE,
        feature,
        message: `بخش «${COMPANY_FEATURE_TITLES[feature]}» برای شرکت حمل‌ونقل شما فعال نیست؛ برای استفاده آن را بخرید.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
