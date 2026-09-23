import { User } from 'src/domain/entities/auth/User';

export interface IUserRepository {
  findById(
    id: string,
  ): Promise<User | null>;

  findByUsernameWithRoles(
    username: string,
  ): Promise<User | null>;

  findByUsernameOrEmailWithRoles(
    value: string,
  ): Promise<User | null>;

  findByMobile(mobile: string): Promise<User | null>;

  create(
    user: User,
  ): Promise<User>;

  createWithRole(user: User, roleName: string): Promise<User>;

  update(
    user: User,
  ): Promise<User>;
}