import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { IsUUID } from 'class-validator';
import { diskStorage } from 'multer';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { User } from 'src/domain/entities/auth/User';
import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { AccountType, CommunicationProvider, SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { SUBSCRIPTION_ORDER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { ISubscriptionOrderRepository } from 'src/domain/repositories/subscription/ISubscriptionOrderRepository';
import { PaymentReceiptService } from 'src/services/subscription/paymentreceipt.service';
import { SubscriptionAccessService } from 'src/services/subscription/subscriptionAccess.service';
import { SubscriptionPlanService } from 'src/services/subscription/subscriptionPlan.service';
import { receiptDir } from 'src/services/subscription/receiptStorage';

type AuthRequest = { user: { userId: string } };

const RECEIPT_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const OPEN_ORDER_STATUSES = [SubscriptionOrderStatus.ReceiptSubmitted, SubscriptionOrderStatus.UnderReview];

const receiptUploadOptions: MulterOptions = {
  storage: diskStorage({
    // the bots' private receipt store (not publicly served), its own folder for the app
    destination: (_req, _file, cb) => cb(null, receiptDir('web')),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${RECEIPT_EXTENSIONS[file.mimetype]}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (!RECEIPT_EXTENSIONS[file.mimetype]) return cb(new BadRequestException('عکس رسید باید JPG، PNG یا WebP باشد.'), false);
    cb(null, true);
  },
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
};

export class CreateWebOrderDto {
  @IsUUID()
  planId!: string;
}

/** The plans a user may buy: a driver's driver plans, a company's company plans (the bots' rule). */
function accountTypeOf(roles: string[]): AccountType | null {
  if (roles.includes('DRIVER')) return AccountType.Driver;
  if (roles.includes('COMPANY') || roles.includes('COMPANY_ADMIN')) return AccountType.Company;
  if (roles.includes('BROKER')) return AccountType.Broker;
  return null;
}

function orderView(order: SubscriptionOrder | null) {
  if (!order) return null;
  return {
    id: order.id,
    status: order.status,
    planTitle: order.subscriptionPlan?.title ?? null,
    amount: order.amount,
    currency: order.currency,
    createdAt: order.createdAt,
    rejectionReason: order.rejectionReason ?? null,
  };
}

/**
 * Buying a subscription inside the app: the same card-to-card receipt as in the bots, into the same review
 * queue (admin/subscription-orders). Deliberately without SubscriptionGuard: buying is the one thing a user
 * whose free period is over can still do.
 */
@Controller('api/subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(SUBSCRIPTION_ORDER_REPOSITORY) private readonly orders: ISubscriptionOrderRepository,
    private readonly access: SubscriptionAccessService,
    private readonly plans: SubscriptionPlanService,
    private readonly receipts: PaymentReceiptService,
    private readonly config: ConfigService,
  ) {}

  /** Whether the user may work now, the plans to buy, the card to pay to and the latest purchase. */
  @Get()
  async status(@Req() request: AuthRequest) {
    const userId = request.user.userId;
    const [access, user, latest] = await Promise.all([
      this.access.check(userId),
      this.loadUser(userId),
      this.orders.findLatestByUserId(userId),
    ]);
    const accountType = accountTypeOf(this.roleNames(user));
    const plans = accountType ? await this.plans.findActiveByAccountType(accountType) : [];
    return {
      access,
      accountType,
      plans: plans.map((plan) => ({
        id: plan.id,
        title: plan.title,
        durationDays: plan.durationDays,
        price: plan.price,
        currency: plan.currency,
      })),
      payment: {
        cardNumber: this.config.get<string>('CARD_NO', ''),
        cardOwner: this.config.get<string>('CARD_OWNER', ''),
      },
      latestOrder: orderView(latest),
    };
  }

  /** Chooses a plan and sends the receipt in one step (multipart: planId + file). */
  @Post('orders')
  @UseInterceptors(FileInterceptor('file', receiptUploadOptions))
  async order(@Req() request: AuthRequest, @Body() dto: CreateWebOrderDto, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('عکس رسید پرداخت را انتخاب کنید.');
    const userId = request.user.userId;
    const user = await this.loadUser(userId);
    const accountType = accountTypeOf(this.roleNames(user));
    if (!accountType) throw new BadRequestException('برای این حساب طرح اشتراکی تعریف نشده است.');

    const latest = await this.orders.findLatestByUserId(userId);
    if (latest && OPEN_ORDER_STATUSES.includes(latest.status)) {
      throw new ConflictException('رسید قبلی شما در حال بررسی است؛ نتیجه را همین‌جا می‌بینید.');
    }

    await this.receipts.submitReceipt({
      newOrder: {
        provider: CommunicationProvider.Web,
        providerUserId: userId,
        phoneNumber: user.mobile ?? user.username,
        accountType,
        subscriptionPlanId: dto.planId,
      },
      imageUrl: file.path,
    });
    return this.status(request);
  }

  private async loadUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId }, relations: { userRoles: { role: true } } });
    if (!user) throw new BadRequestException('حساب کاربری پیدا نشد.');
    return user;
  }

  private roleNames(user: User): string[] {
    return (user.userRoles ?? [])
      .filter((userRole) => userRole.role?.recordStatus === RecordStatus.Active)
      .map((userRole) => userRole.role.name);
  }
}
