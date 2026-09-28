import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';

import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { JWT_ALGORITHM, readJwtPublicKey } from '../jwtKeys';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: readJwtPublicKey(configService),

      algorithms: [JWT_ALGORITHM],
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<JwtPayload> {
    return payload;
  }
}