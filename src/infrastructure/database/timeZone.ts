/**
 * The database session runs in the Node process's time zone.
 *
 * The time columns are `timestamp without time zone`: the database writes now() (CreateDateColumn, defaults) in its
 * session zone, and node-postgres reads every value back as Node's local time. With the server on Europe/Istanbul
 * (+03:00) and Node on Asia/Tehran (+03:30), a load registered a moment ago read as «۳۰ دقیقه پیش», and times the
 * code writes (deliveredAt = new Date()) did not line up with the database's own. One zone for both fixes the class.
 */
export const NODE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** TypeORM `extra` for postgres: the session's TimeZone setting on connect. */
export const sessionTimeZone = { options: `-c timezone=${NODE_TIME_ZONE}` };
