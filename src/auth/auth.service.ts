import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PasswordService } from 'src/services/auth/password.service';

import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';

import {
  USER_REPOSITORY,
} from 'src/domain/repositories/repository.tokens';

import { JwtPayload,UserLoginResultDto } from 'src/domain/entities/auth/jwt-payload.dto';

import { LoginDto } from 'src/dto/auth/login-dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,

    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,

    private readonly passwordService: PasswordService,

    private readonly configService: ConfigService,
  ) {}

  async login(
    loginDto: LoginDto,
  ): Promise<UserLoginResultDto> {
    const check = await this.validateUser(loginDto);

    if (!check.isAuthenticate || !check.user) {
      return check;
    }

    const payload = new JwtPayload(check.user);

    if (payload.roles.length === 0) {
      throw new HttpException(
        'User has no active roles',
        HttpStatus.UNAUTHORIZED,
      );
    }

    check.accessToken = this.jwtService.sign({
      ...payload,
    });

    check.user = null;

    return check;
  }

  async loginWithGoogle(
    email: string,
  ): Promise<UserLoginResultDto> {
    const check = await this.validateExternalLogin(email);

    if (!check.isAuthenticate || !check.user) {
      return check;
    }

    const payload = new JwtPayload(check.user);

    if (payload.roles.length === 0) {
      throw new HttpException(
        'User has no active roles',
        HttpStatus.UNAUTHORIZED,
      );
    }

    check.accessToken = this.jwtService.sign({
      ...payload,
    });

    check.user = null;

    return check;
  }

  async loginWithApple(
    email: string,
  ): Promise<UserLoginResultDto> {
    const check = await this.validateExternalLogin(email);

    if (!check.isAuthenticate || !check.user) {
      return check;
    }

    const payload = new JwtPayload(check.user);

    if (payload.roles.length === 0) {
      throw new HttpException(
        'User has no active roles',
        HttpStatus.UNAUTHORIZED,
      );
    }

    check.accessToken = this.jwtService.sign({
      ...payload,
    });

    check.user = null;

    return check;
  }

  async loginForResetPassword(
    loginDto: LoginDto,
  ): Promise<UserLoginResultDto> {
    const check = await this.validateExternalLogin(
      loginDto.username,
    );

    if (!check.isAuthenticate || !check.user) {
      return check;
    }

    const payload = new JwtPayload(check.user);

    check.accessToken = this.jwtService.sign({
      ...payload,
    });

    check.user = null;

    return check;
  }

  async generateTokenWithoutLogin(
    user: User,
  ): Promise<string> {
    const payload = new JwtPayload(user);

    return this.jwtService.sign({
      ...payload,
    });
  }

  async validateUser(
    loginDto: LoginDto,
  ): Promise<UserLoginResultDto> {
    const result = new UserLoginResultDto();

    const user = await this.userRepository.findByUsernameWithRoles(
      loginDto.username,
    );

    if (
      !user ||
      user.recordStatus !== RecordStatus.Active
    ) {
      result.isAuthenticate = false;
      result.user = null;
      result.message =
        'User does not exist or is inactive.';

      return result;
    }

    const passwordIsValid =
      await this.passwordService.comparePasswords(
        loginDto.password,
        user.passwordHash,
      );

    if (!passwordIsValid) {
      result.isAuthenticate = false;
      result.user = null;
      result.message =
        'Username or password is incorrect.';

      return result;
    }

    result.isAuthenticate = true;
    result.user = user;

    return result;
  }

  private async validateExternalLogin(
    usernameOrEmail: string,
  ): Promise<UserLoginResultDto> {
    const result = new UserLoginResultDto();

    const user =
      await this.userRepository.findByUsernameOrEmailWithRoles(
        usernameOrEmail,
      );

    if (
      !user ||
      user.recordStatus !== RecordStatus.Active
    ) {
      result.isAuthenticate = false;
      result.user = null;
      result.message =
        'User does not exist or is inactive.';

      return result;
    }

    result.isAuthenticate = true;
    result.user = user;

    return result;
  }

  parseJwt(token: string): unknown {
    try {
      return this.jwtService.decode(token);
    } catch {
      throw new Error('Failed to parse JWT');
    }
  }

  async verifyJwt(
    token: string,
  ): Promise<unknown> {
    try {
      const secret =
        this.configService.getOrThrow<string>(
          'JWT_SECRET_KEY',
        );

      return await this.jwtService.verifyAsync(
        token,
        {
          secret,
        },
      );
    } catch {
      throw new Error(
        'Invalid or expired JWT',
      );
    }
  }

  generateGoogleAuthUrl(
    heardAboutUs: string,
  ): string {
    const clientId =
      this.configService.getOrThrow<string>(
        'GOOGLE_CLIENT_ID',
      );

    const redirectUri =
      this.configService.getOrThrow<string>(
        'GOOGLE_REDIRECT_URI',
      );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'email profile',
      state: heardAboutUs,
    });

    return (
      'https://accounts.google.com/o/oauth2/auth?' +
      params.toString()
    );
  }

  async verifyGoogleToken(token: string) {
    try {
      const response = await fetch(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Google API returned ${response.status}`,
        );
      }

      const payload =
        (await response.json()) as {
          sub?: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
          given_name?: string;
          family_name?: string;
          picture?: string;
        };

      if (
        !payload.sub ||
        !payload.email
      ) {
        throw new Error(
          'Invalid token payload',
        );
      }

      return {
        id: payload.sub,
        email: payload.email,
        emailVerified:
          payload.email_verified ?? false,
        name: payload.name,
        givenName: payload.given_name,
        familyName: payload.family_name,
        picture: payload.picture,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error';

      throw new Error(
        `Error verifying Google token: ${message}`,
      );
    }
  }
}