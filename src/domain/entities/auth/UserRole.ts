import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
  Unique,
} from 'typeorm';

import { User } from './User';
import { Role } from './Role';

@Entity('UserRole')
@Unique(['userId', 'roleId'])
@Index(['userId'])
@Index(['roleId'])
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(
    () => User,
    user => user.userRoles,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column('uuid')
  roleId!: string;

  @ManyToOne(
    () => Role,
    role => role.userRoles,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @CreateDateColumn()
  createdAt!: Date;
}