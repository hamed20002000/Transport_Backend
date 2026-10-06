import { Body, Controller, ForbiddenException, Get, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsISO8601, IsOptional, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionPolicyService } from 'src/services/subscription/subscriptionPolicy.service';

type AdminRequest = { user?: { userId?: string; roles?: string[]; isActive?: boolean } };

export function requireAdmin(request: AdminRequest): string | undefined {
  if (request.user?.isActive !== true || !request.user.roles?.includes('ADMIN')) {
    throw new ForbiddenException('Administrator access required.');
  }
  return request.user.userId;
}

export class UpdateSubscriptionPolicyDto {
  /** false = اشتراک هیچ‌جا لازم نیست. */
  @IsBoolean()
  enforced!: boolean;

  /** تا این تاریخ رایگان؛ بعد از آن اگر enforced باشد خودکار اجباری می‌شود. null = بدون دوره‌ی رایگان. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  freeUntil?: string | null;
}

/**
 * روشن/خاموش کردن اجباری بودن اشتراک بدون ری‌استارت.
 *   خاموش:                  { "enforced": false }
 *   اجباری از همین الان:    { "enforced": true, "freeUntil": null }
 *   ۳ ماه رایگان، بعد اجباری: { "enforced": true, "freeUntil": "2027-01-06T00:00:00Z" }
 */
@Controller('api/admin/subscription-policy')
@UseGuards(JwtAuthGuard)
export class SubscriptionPolicyController {
  constructor(private readonly policy: SubscriptionPolicyService) {}

  @Get()
  get(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.policy.getStatus();
  }

  @Put()
  update(@Req() request: AdminRequest, @Body() dto: UpdateSubscriptionPolicyDto) {
    const adminUserId = requireAdmin(request);
    const freeUntil = dto.freeUntil ? new Date(dto.freeUntil).toISOString() : null;
    return this.policy.update({ enforced: dto.enforced, freeUntil }, adminUserId);
  }
}
