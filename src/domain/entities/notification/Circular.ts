import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A circular (بخشنامه) the admin uploads for the drivers: a title, a text and a file (PDF or picture, optional),
 * announced to every driver (CircularService.announce) and kept in their panel.
 */
@Entity('Circular')
@Index('IDX_Circular_createdAt', ['createdAt'])
export class Circular {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  /** the stored file's random name in CIRCULAR_DIR (outside the public uploads); null without a file */
  @Column({ type: 'varchar', length: 80, nullable: true })
  fileName?: string | null;

  /** the name it was uploaded with, for the download */
  @Column({ type: 'varchar', length: 200, nullable: true })
  originalName?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType?: string | null;

  @Column({ type: 'int', nullable: true })
  size?: number | null;

  /** drivers it was announced to, and how many of them a messenger took it to so far (the push goes besides) */
  @Column({ type: 'int', default: 0 })
  recipients!: number;

  @Column({ type: 'int', default: 0 })
  notified!: number;

  /** the announcement went through every driver */
  @Column({ type: 'timestamp', nullable: true })
  notifiedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  /** removed by the admin: no longer in the drivers' panel */
  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date | null;
}
