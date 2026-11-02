import { InviteUsedEvent, REDIS_CHANNELS } from '../redis/redis.keys';

/** what can run a query: a DataSource, an EntityManager or a repository's manager */
interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/** where the news goes: RedisService (InviteUsageNotifier tells the inviter's open page) */
interface Publisher {
  publish(channel: string, message: string): Promise<void>;
}

// each invite table: who invited and who was invited
const INVITES = [
  { kind: 'driver', table: 'DriverInvite', inviter: 'companyUserId', invitee: 'driverUserId' },
  { kind: 'factory', table: 'FactoryInvite', inviter: 'companyUserId', invitee: 'factoryUserId' },
  { kind: 'company', table: 'CompanyInvite', inviter: 'parentUserId', invitee: 'companyUserId' },
] as const;

/**
 * The invited number came in, by any way (the web panel's SMS code, a messenger bot, WhatsApp), not only by
 * opening its invite link: its driver, factory and company invites count as used («وارد شده» for the inviter), and
 * the inviter's open page hears of it at once. A failure is swallowed: signing in never fails over this.
 */
export async function markInvitesUsed(db: Queryable, mobile: string | null | undefined, publisher?: Publisher): Promise<void> {
  if (!mobile) return;
  for (const { kind, table, inviter, invitee } of INVITES) {
    try {
      const rows = (await db.query(
        `UPDATE "${table}" SET "usedAt" = now() WHERE mobile = $1 AND "usedAt" IS NULL RETURNING "${inviter}" AS inviter, "${invitee}" AS invitee`,
        [mobile],
      )) as unknown;
      // a raw UPDATE … RETURNING comes back as [rows, count] from TypeORM's postgres driver
      const used = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows) as Array<{ inviter: string; invitee: string }>;
      for (const row of Array.isArray(used) ? used : []) {
        const event: InviteUsedEvent = { kind, inviterUserId: row.inviter, inviteeUserId: row.invitee };
        await publisher?.publish(REDIS_CHANNELS.inviteUsed, JSON.stringify(event)).catch(() => undefined);
      }
    } catch {
      // the next sign-in marks it
    }
  }
}
