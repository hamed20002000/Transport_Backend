import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { ToolDomain } from './ToolDomain';

@Index('Embedding_pkey', ['Id'], { unique: true })
@Entity('EmbeddingTool', { schema: 'public' })
export class EmbeddingTool {
  @Column('uuid', {
    primary: true,
    name: 'Id',
    generated: 'uuid',
  })
  Id!: string;

  @Column('character varying', {
    name: 'ToolName',
    nullable: false,
  })
  ToolName!: string;

  @Column('text', {
    name: 'Document',
  })
  Document!: string;

  /**
   * این ستون در PostgreSQL از نوع vector(1024) است.
   *
   * عمداً @Column ندارد چون نسخه فعلی TypeORM پروژه
   * pgvector را به‌صورت native مدیریت نمی‌کند.
   *
   * خواندن/نوشتن Embedding توسط Raw SQL انجام می‌شود.
   */
  Embedding?: number[];

  @Column('text', {
    name: 'DomainName',
    nullable: true,
  })
  DomainName?: string;

  @ManyToOne(
    () => ToolDomain,
    (domain) => domain.Tools,
    {
      nullable: true,
    },
  )
  @JoinColumn({
    name: 'DomainName',
    referencedColumnName: 'DomainName',
  })
  Domain?: ToolDomain;
}