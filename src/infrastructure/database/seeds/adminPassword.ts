/**
 * The username and password of an administrator, for the admin panel's own sign-in (/auth/admin):
 *
 *   npm run admin:password -- <username> '<password>' [mobile of the admin account]
 *
 * Gives the admin account (the one with that mobile, or the only ADMIN account) this username and the argon2 hash of
 * the password; the password itself is kept nowhere. Run again to change either.
 */
import 'reflect-metadata';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';

async function main(): Promise<void> {
  const [username, password, mobile] = process.argv.slice(2);
  if (!username || !password) throw new Error("Usage: npm run admin:password -- <username> '<password>' [mobile]");
  if (password.length < 8) throw new Error('The password must be at least 8 characters.');
  config();
  const dataSource = new DataSource({ ...(typeOrmConfig(new ConfigService()) as DataSourceOptions), entities: [], migrations: [], logging: false });
  await dataSource.initialize();
  try {
    const admins: Array<{ id: string; mobile: string | null }> = await dataSource.query(
      `SELECT DISTINCT u.id, u.mobile FROM "User" u
         JOIN "UserRole" ur ON ur."userId" = u.id
         JOIN "Role" r ON r.id = ur."roleId" AND r.name = 'ADMIN'
        WHERE ($1::text IS NULL OR u.mobile = $1)`,
      [mobile ?? null],
    );
    if (admins.length !== 1) throw new Error(admins.length ? 'More than one admin account: give its mobile too.' : 'No admin account found.');
    const [taken] = await dataSource.query(`SELECT id FROM "User" WHERE lower(username) = lower($1) AND id <> $2`, [username, admins[0].id]);
    if (taken) throw new Error(`The username «${username}» belongs to another account.`);
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await dataSource.query(`UPDATE "User" SET username = $1, "passwordHash" = $2 WHERE id = $3`, [username, hash, admins[0].id]);
    console.log(`Admin ${admins[0].mobile ?? admins[0].id}: username «${username}» and its password are set.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
