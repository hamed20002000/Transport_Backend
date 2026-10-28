import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../../domain/entities/auth/User';
import { CompanyFeatureGrant } from '../../domain/entities/company/CompanyFeatureGrant';
import { CompanyFeatureOrder } from '../../domain/entities/company/CompanyFeatureOrder';
import { CompanyFeaturePlan } from '../../domain/entities/company/CompanyFeaturePlan';
import { CompanyFeatureGuard } from '../../auth/guards/companyFeature.guard';
import { CompanyFeatureController } from '../../presentation/controllers/company/company-feature.controller';
import { CompanyFeatureService } from '../../services/company/companyFeature.service';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from './RedisModule';
import { InviteSmsService } from '../../services/company/inviteSms.service';
import { AccountVerificationService } from '../../services/company/accountVerification.service';
import { AccountVerificationController, CompanyVerificationController } from '../../presentation/controllers/company/account-verification.controller';
import { CompanyInvite } from '../../domain/entities/company/CompanyInvite';
import { CompanyInviteService } from '../../services/company/companyInvite.service';
import { CompanyInviteController, CompanyInviteInfoController } from '../../presentation/controllers/company/company-invite.controller';
import { AppSetting } from '../../domain/entities/setting/AppSetting';
import { BrokerAccessOrder } from '../../domain/entities/company/BrokerAccessOrder';
import { BrokerAccessPeriod } from '../../domain/entities/company/BrokerAccessPeriod';
import { BrokerAccessService } from '../../services/company/brokerAccess.service';
import { BrokerAccessController } from '../../presentation/controllers/company/broker-access.controller';

/** شرکت مادر، منوهای پولی شرکت‌های غیرمادر و خرید واسط برای دیدن بار شرکت‌ها؛ CompanyFeatureGuard را هر ماژولی که import کند می‌تواند بگذارد. */
@Module({
  imports: [TypeOrmModule.forFeature([User, CompanyFeaturePlan, CompanyFeatureOrder, CompanyFeatureGrant, CompanyInvite, AppSetting, BrokerAccessOrder, BrokerAccessPeriod]), RedisModule, HttpModule],
  controllers: [CompanyFeatureController, CompanyInviteController, CompanyInviteInfoController, AccountVerificationController, CompanyVerificationController, BrokerAccessController],
  providers: [CompanyFeatureService, CompanyFeatureGuard, CompanyInviteService, InviteSmsService, AccountVerificationService, BrokerAccessService],
  exports: [CompanyFeatureService, CompanyFeatureGuard, CompanyInviteService, InviteSmsService, AccountVerificationService, BrokerAccessService],
})
export class CompanyFeatureModule {}
