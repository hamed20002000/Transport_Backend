import { Body, Controller, Get, Patch, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { UpdateUserProfileDto } from 'src/dto/user/update-user-profile.dto';
import { UserService } from 'src/services/UserService';

type AuthRequest = { user?: JwtPayload };

function currentUserId(request: AuthRequest): string {
  const userId = request.user?.userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
}

@Controller('api/users/me/profile')
@ApiTags('User Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class UserProfileController {
  constructor(private readonly users: UserService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user personal/company profile' })
  get(@Req() request: AuthRequest) {
    return this.users.getProfile(currentUserId(request));
  }

  @Patch()
  @ApiOperation({ summary: 'Fill in or edit the current user profile (all fields optional, null clears a field)' })
  update(@Req() request: AuthRequest, @Body() dto: UpdateUserProfileDto) {
    return this.users.updateProfile(currentUserId(request), dto);
  }
}
