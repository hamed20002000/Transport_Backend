import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionPlan } from 'src/domain/entities/subscription/SubscriptionPlan';
import { AccountType } from 'src/domain/enums/subscription';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

export class CreateSubscriptionPlanDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(150)
  title!: string;

  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsInt() @Min(1) @Max(2147483647)
  durationDays!: number;

  // A decimal string keeps bigint amounts exact across JSON and JavaScript.
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/)
  price!: string;

  @IsIn(['IRR', 'GBP', 'EUR', 'SAR', 'CNY'])
  currency: string = 'IRR';

  @IsIn([0, 1])
  recordStatus: number = 0;

  @IsInt() @Min(0) @Max(2147483647)
  sortOrder: number = 0;
}

@Controller('api/admin/subscription-plans')
@UseGuards(JwtAuthGuard)
export class SubscriptionPlanController {
  constructor(@InjectRepository(SubscriptionPlan) private readonly plans: Repository<SubscriptionPlan>) {}

  private requireAdmin(request: { user?: { roles?: string[]; isActive?: boolean } }) {
    if (request.user?.isActive !== true || !request.user.roles?.includes('ADMIN')) {
      throw new ForbiddenException('Administrator access required.');
    }
  }

  @Get()
  list(@Req() request: { user?: { roles?: string[]; isActive?: boolean } }) {
    this.requireAdmin(request);
    return this.plans.find({ where: { recordStatus: RecordStatus.Active }, order: { sortOrder: 'ASC', createdAt: 'DESC' } });
  }

  @Post()
  create(@Req() request: { user?: { roles?: string[]; isActive?: boolean } }, @Body() dto: CreateSubscriptionPlanDto) {
    this.requireAdmin(request);
    return this.plans.save(this.plans.create(dto));
  }

  // Deleting only deactivates the plan so existing subscriptions and orders keep their reference.
  @Delete(':id')
  async remove(@Req() request: { user?: { roles?: string[]; isActive?: boolean } }, @Param('id', ParseUUIDPipe) id: string) {
    this.requireAdmin(request);
    const result = await this.plans.update({ id, recordStatus: RecordStatus.Active }, { recordStatus: RecordStatus.Inactive });
    if (!result.affected) throw new NotFoundException('Subscription plan not found.');
    return { id };
  }
}
