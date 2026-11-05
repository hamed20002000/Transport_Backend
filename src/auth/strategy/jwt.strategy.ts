import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';

import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { SessionService } from 'src/services/auth/session.service';
import { JWT_ALGORITHM, readJwtPublicKey } from '../jwtKeys';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: readJwtPublicKey(configService),

      algorithms: [JWT_ALGORITHM],
    });
  }

  /** A token of a session replaced by a sign-in elsewhere is refused (401 SESSION_REPLACED). */
  async validate(
    payload: JwtPayload,
  ): Promise<JwtPayload> {
    await this.sessions.assertCurrent(payload.userId, payload);
    return payload;
  }
}