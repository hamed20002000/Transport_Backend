import { User } from 'src/domain/entities/auth/User';
import { UserRole } from 'src/domain/entities/auth/UserRole';
import { PasswordService } from 'src/services/auth/password.service';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Role } from 'src/domain/entities/auth/Role';
import { AccountType } from 'src/domain/enums/subscription';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

const roleTitles: Record<AccountType | 'ADMIN', string> = {
  [AccountType.Driver]: 'راننده',
  [AccountType.Company]: 'شرکت',
  [AccountType.Broker]: 'واسطه',
  ADMIN: 'مدیر سیستم',
};

export async function seedRoles(dataSource: DataSource): Promise<boolean> {
  return dataSource.transaction(async (manager) => {
    // Serialize the empty-table check and insertion across concurrent seed runs.
    await manager.query('LOCK TABLE "Role" IN SHARE ROW EXCLUSIVE MODE');
    const roles = manager.getRepository(Role);

    if (await roles.count()) {
      return false;
    }

    await roles.insert(
      [...Object.values(AccountType), 'ADMIN' as const].map((name) => ({
        name,
        title: roleTitles[name],
        recordStatus: RecordStatus.Active,
      })),
    );
    return true;
  });
}

export async function seedAdmin(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await manager.query('LOCK TABLE "Role", "User", "UserRole" IN SHARE ROW EXCLUSIVE MODE');
    let role = await manager.findOne(Role, { where: { name: 'ADMIN' } });
    if (!role) {
      role = await manager.save(
        Role,
        manager.create(Role, {
          name: 'ADMIN',
          title: roleTitles.ADMIN,
          recordStatus: RecordStatus.Active,
        }),
      );
    }

    let user = await manager.findOne(User, { where: { username: 'super_admin' } });
    if (!user) {
      const passwordHash = await new PasswordService().hashPassword('123qwe$%AS');
      user = await manager.save(
        User,
        manager.create(User, {
          username: 'super_admin',
          passwordHash,
          recordStatus: RecordStatus.Active,
          mustChangePassword: false,
        }),
      );
    }

    const existingLink = await manager.findOne(UserRole, {
      where: { userId: user.id, roleId: role.id },
    });
    if (!existingLink) {
      await manager.save(
        UserRole,
        manager.create(UserRole, {
          userId: user.id,
          roleId: role.id,
        }),
      );
    }
  });
}

async function seed(): Promise<void> {
  const { AppDataSource } = require('../data-source') as { AppDataSource: DataSource };
  try {
    await AppDataSource.initialize();
    const inserted = await seedRoles(AppDataSource);
    console.log(
      inserted ? 'Seeded roles: DRIVER, COMPANY, BROKER, ADMIN' : 'Role table is not empty; skipped seeding.',
    );
    await seedAdmin(AppDataSource);
    console.log('Admin seed complete: super_admin / ADMIN');
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

if (require.main === module) {
  seed().catch((error: unknown) => {
    console.error('Role seeding failed:', error);
    process.exitCode = 1;
  });
}
