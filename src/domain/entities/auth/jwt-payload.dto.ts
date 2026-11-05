import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

export class JwtPayload {
  userId!: string;
  username!: string;
  roles!: string[];
  isActive!: boolean;
  /** the web session the token belongs to (SessionService); absent on older tokens */
  sid?: string;
  /** may be signed in on many devices at once (the parent company) */
  multi?: boolean;

  constructor(user: User) {
    this.userId = user.id;

    this.username = user.username;

    this.roles =
      user.userRoles
        ?.filter(
          userRole =>
            userRole.role?.recordStatus === RecordStatus.Active,
        )
        .map(userRole => userRole.role.name) ?? [];

    this.isActive =
      user.recordStatus === RecordStatus.Active;
  }
}

export class UserLoginResultDto {
  isAuthenticate!: boolean;

  accessToken?: string;

  message?: string;

  user!: User | null;
}