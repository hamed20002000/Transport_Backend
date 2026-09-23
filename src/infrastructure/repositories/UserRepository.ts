import { Role } from 'src/domain/entities/auth/Role';
import { UserRole } from 'src/domain/entities/auth/UserRole';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/auth/User';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';

@Injectable()
export class UserRepository
  implements IUserRepository
{
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findById(
    id: string,
  ): Promise<User | null> {
    return this.repository.findOne({
      where: { id },
      relations: {
        userRoles: {
          role: true,
        },
      },
    });
  }

  findByUsernameWithRoles(
    username: string,
  ): Promise<User | null> {
    return this.repository.findOne({
      where: {
        username,
      },
      relations: {
        userRoles: {
          role: true,
        },
      },
    });
  }

  findByUsernameOrEmailWithRoles(
    value: string,
  ): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .leftJoinAndSelect(
        'user.userRoles',
        'userRole',
      )
      .leftJoinAndSelect(
        'userRole.role',
        'role',
      )
      .where(
        'user.username = :value',
        { value },
      )
      .orWhere(
        'user.email = :value',
        { value },
      )
      .getOne();
  }

  findByMobile(mobile: string): Promise<User | null> {
    const national = mobile.substring(1);
    return this.repository.findOne({ where: [
      { mobile }, { mobile: `+98${national}` }, { mobile: `98${national}` },
      { mobile: `0098${national}` },
    ] });
  }

  create(
    user: User,
  ): Promise<User> {
    return this.repository.save(user);
  }

  async createWithRole(user: User, roleName: string): Promise<User> {
    return this.repository.manager.transaction(async manager => {
      const role = await manager.findOne(Role, {
        where: { name: roleName, recordStatus: RecordStatus.Active },
      });
      if (!role) {
        throw new NotFoundException(`Active role "${roleName}" not found`);
      }
      const savedUser = await manager.save(User, user);
      await manager.save(UserRole, manager.create(UserRole, {
        userId: savedUser.id,
        roleId: role.id,
      }));
      savedUser.userRoles = [Object.assign(new UserRole(), { userId: savedUser.id, roleId: role.id, role })];
      return savedUser;
    });
  }

  update(
    user: User,
  ): Promise<User> {
    return this.repository.save(user);
  }
}