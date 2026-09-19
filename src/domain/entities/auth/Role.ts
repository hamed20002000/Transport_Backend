import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RecordStatus } from '../../enums/RecordStatus';
import { UserRole } from './UserRole';

@Entity('Role')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  title?: string;

  @Column({
    type: 'smallint',
    default: RecordStatus.Active,
  })
  recordStatus!: RecordStatus;

  @OneToMany(
    () => UserRole,
    userRole => userRole.role,
  )
  userRoles!: UserRole[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}