import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { InviteUsedEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { inviteToken } from './inviteLinks';

/**
 * The rules every invite link keeps (driver, factory, company):
 *   - it waits a day (INVITE_EXPIRY_HOURS) for its number to come in; then its link stops, it is revoked, and the
 *     account it made goes too when nobody ever came in with it and no one else invited it (expireStaleInvites);
 *   - a number already in Trabot (came in by an invite, or signed up alone) is not invited again, and one another
 *     inviter's invite waits for belongs to that one until it is used or its day is over (assertInvitable).
 */
export const inviteExpiryHours = () => Number(process.env.INVITE_EXPIRY_HOURS ?? process.env.DRIVER_INVITE_EXPIRY_HOURS) || 24;

interface InviteLike {
  usedAt?: Date | string | null;
  revokedAt?: Date | string | null;
  createdAt?: Date | string;
}

/** an invite nobody used within its time: its link no longer works, even before the sweep revokes it */
export function isInviteExpired(invite: InviteLike): boolean {
  return !invite.usedAt && Date.now() - new Date(invite.createdAt!).getTime() > inviteExpiryHours() * 60 * 60_000;
}

/** when an invite still waiting is over (null once used) */
export function inviteExpiresAt(invite: InviteLike): Date | null {
  return invite.usedAt ? null : new Date(new Date(invite.createdAt!).getTime() + inviteExpiryHours() * 60 * 60_000);
}

/**
 * May inviterId invite an account that is there already? Yes when its own invite still waits (the SMS goes again),
 * or when only an invite made the account and nobody came in with it (that invite's day over). Otherwise refused:
 * another inviter's invite still waits, or the account came in (invited or alone). noun: «راننده», «کارخانه», «شرکت».
 */
export function assertInvitable(
  invites: Array<InviteLike & { inviterId: string }>,
  inviterId: string,
  accountCreatedAt: Date | string | undefined,
  noun: string,
): void {
  const waiting = invites.filter((invite) => !invite.revokedAt && !invite.usedAt && !isInviteExpired(invite));
  if (waiting.some((invite) => invite.inviterId === inviterId)) return;
  if (waiting.length) {
    throw new ConflictException(`این ${noun} را شرکت دیگری دعوت کرده است؛ اگر تا ${inviteExpiryHours()} ساعت وارد نشود، می‌توانید دعوتش کنید.`);
  }
  const madeByInvite = invites.some(
    (invite) => !!accountCreatedAt && Math.abs(new Date(invite.createdAt!).getTime() - new Date(accountCreatedAt).getTime()) < 60_000,
  );
  if (madeByInvite && !invites.some((invite) => invite.usedAt)) return;
  throw new ConflictException(`این ${noun} خودش در ترابوت است و دعوت لازم ندارد.`);
}

/** an invite row still waiting for its number (not revoked, not used, its day not over) */
export const isInviteWaiting = (invite: InviteLike) => !invite.revokedAt && !invite.usedAt && !isInviteExpired(invite);

/**
 * An invite row used again for a new invite (one row a pair, or a company): a new token and a new day from now.
 * Kept as it was, a revoked or old row would count as expired at once (its day runs from createdAt).
 */
export const renewedInvite = () => ({ token: inviteToken(), createdAt: new Date(), usedAt: null, revokedAt: null });

// each invite table: who invited, who was invited, and what the invite tied between them (undone when it expires)
const KINDS = [
  {
    kind: 'driver',
    table: 'DriverInvite',
    inviter: 'companyUserId',
    invitee: 'driverUserId',
    untie: `UPDATE "DriverProfile" SET "companyUserIds" = array_remove("companyUserIds", $2) WHERE "userId" = $1`,
  },
  {
    kind: 'factory',
    table: 'FactoryInvite',
    inviter: 'companyUserId',
    invitee: 'factoryUserId',
    untie: `DELETE FROM "FactoryCompany" WHERE "factoryUserId" = $1 AND "companyUserId" = $2`,
  },
  {
    kind: 'company',
    table: 'CompanyInvite',
    inviter: 'parentUserId',
    invitee: 'companyUserId',
    untie: `UPDATE "User" SET "invitedByCompanyUserId" = NULL WHERE id = $1 AND "invitedByCompanyUserId" = $2`,
  },
] as const;

/**
 * Invites nobody used within their day, of every kind: revoked, what they tied undone, and the account the invite
 * made deleted when nobody ever came in with it (no used invite, no messenger linked) and no other invite of its
 * kind still waits for it. Each inviter's open page hears of it. Returns how many expired.
 */
export async function expireStaleInvites(
  dataSource: DataSource,
  publisher: { publish(channel: string, message: string): Promise<void> },
): Promise<number> {
  let expired = 0;
  for (const { kind, table, inviter, invitee, untie } of KINDS) {
    const stale: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM "${table}" WHERE "usedAt" IS NULL AND "revokedAt" IS NULL AND "createdAt" < now() - make_interval(hours => $1)`,
      [inviteExpiryHours()],
    );
    for (const { id } of stale) {
      const gone = await dataSource.transaction(async (manager) => {
        const rows = (await manager.query(
          `UPDATE "${table}" SET "revokedAt" = now() WHERE id = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL
           RETURNING "${inviter}" AS inviter, "${invitee}" AS invitee`,
          [id],
        )) as [Array<{ inviter: string; invitee: string }>, number];
        const invite = rows[0][0];
        if (!invite) return null;
        await manager.query(untie, [invite.invitee, invite.inviter]);
        await manager.query(
          `DELETE FROM "User" u USING "${table}" made
            WHERE u.id = $1 AND made.id = $2
              AND made."createdAt" BETWEEN u."createdAt" - interval '1 minute' AND u."createdAt" + interval '1 minute'
              AND NOT EXISTS (SELECT 1 FROM "${table}" i WHERE i."${invitee}" = u.id AND (i."usedAt" IS NOT NULL OR i."revokedAt" IS NULL))
              AND NOT EXISTS (SELECT 1 FROM "BotLink" b WHERE b."userId" = u.id)
              AND NOT EXISTS (SELECT 1 FROM "WhatsappUserMapping" w WHERE w.userid::text = u.id::text)`,
          [invite.invitee, id],
        );
        return invite;
      });
      if (!gone) continue;
      expired += 1;
      const event: InviteUsedEvent = { kind, inviterUserId: gone.inviter, inviteeUserId: gone.invitee, expired: true };
      await publisher.publish(REDIS_CHANNELS.inviteUsed, JSON.stringify(event)).catch(() => undefined);
    }
  }
  return expired;
}
