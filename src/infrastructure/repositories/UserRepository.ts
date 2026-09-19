import { Injectable } from '@nestjs/common';
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

  create(
    user: User,
  ): Promise<User> {
    return this.repository.save(user);
  }

  update(
    user: User,
  ): Promise<User> {
    return this.repository.save(user);
  }
}