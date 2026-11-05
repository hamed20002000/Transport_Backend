import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { RedisService } from '../redis/redis.service';

/** The answer when a session was replaced by a sign-in elsewhere: the web app signs out and says why. */
export const SESSION_REPLACED = 'SESSION_REPLACED';

// as long as a refresh token lives: an idle session ends with it
const SESSION_TTL_SECONDS = 30 * 24 * 3600;

/** What a token carries about its session (JwtPayload.sid / multi). */
export interface SessionClaims {
  /** the session the token belongs to; absent on tokens from before sessions were kept */
  sid?: string;
  /** an account that may be signed in on many devices at once (the parent company) */
  multi?: boolean;
}

/**
 * One web session per account at a time: a sign-in on another browser or device takes the account over, and the
 * one before is signed out (its access token, refresh token and open pages stop working, with SESSION_REPLACED).
 * The parent company is the exception (multi): the people signing in to it (ParentCompanyLogin) work at once.
 *
 * The current session of an account is one Redis key (activeSession); a token's sid is checked against it on every
 * request (JwtStrategy), every socket (NotificationsGateway) and every refresh (RegistrationService).
 */
@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  /** A new sign-in: its session id; for a single-session account it becomes the only valid one. */
  async start(userId: string, multi: boolean): Promise<string> {
    const sid = randomUUID();
    if (!multi) await this.redis.set(RedisService.key('activeSession', userId), sid, SESSION_TTL_SECONDS);
    return sid;
  }

  /**
   * A refresh: the same session goes on (and its time is renewed) if it is still the account's one; 401
   * SESSION_REPLACED if another sign-in took over. A refresh token from before sessions (no sid) starts one only when
   * the account has none, so two old devices do not take turns throwing each other out.
   */
  async resume(userId: string, multi: boolean, sid: string | undefined): Promise<string> {
    if (multi) return sid ?? randomUUID();
    const key = RedisService.key('activeSession', userId);
    const active = await this.redis.get(key);
    if (!sid) {
      if (active) throw new UnauthorizedException(SESSION_REPLACED);
      return this.start(userId, multi);
    }
    if (active !== sid) throw new UnauthorizedException(SESSION_REPLACED);
    await this.redis.expire(key, SESSION_TTL_SECONDS);
    return sid;
  }

  /** Whether a token may still be used: always for a multi account; else only its account's current session. */
  async isCurrent(userId: string, claims: SessionClaims): Promise<boolean> {
    if (claims.multi) return true;
    const active = await this.redis.get(RedisService.key('activeSession', userId));
    // a token from before sessions: fine until the account signs in somewhere (then it has a session that is not it)
    return claims.sid ? active === claims.sid : !active;
  }

  /** 401 SESSION_REPLACED unless the token is of the current session. */
  async assertCurrent(userId: string, claims: SessionClaims): Promise<void> {
    if (!(await this.isCurrent(userId, claims))) throw new UnauthorizedException(SESSION_REPLACED);
  }

  /** «خروج» on this device: its session ends, if it is still the current one. */
  async end(userId: string, sid: string | undefined): Promise<void> {
    if (sid) await this.redis.deleteIfValue(RedisService.key('activeSession', userId), sid);
  }
}
