import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';

import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
  ) {
    const secret =
      configService.getOrThrow<string>(
        'JWT_SECRET_KEY',
      );

    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: secret,
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<JwtPayload> {
    return payload;
  }
}