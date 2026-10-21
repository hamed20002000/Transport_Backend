import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * اشتراک اعلان سیستمی (Web Push) یک مرورگر یا برنامه‌ی نصب‌شده (PWA): همان خبرهایی که پیام‌رسان‌ها می‌گیرند
 * (درخواست راننده، تحویل، …) به‌صورت اعلان گوشی هم می‌آید، حتی وقتی برنامه بسته است.
 */
@Entity('WebPushSubscription')
@Index('IDX_WebPushSubscription_userId', ['userId'])
export class WebPushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  // آدرس سرویس اعلان مرورگر؛ برای هر دستگاه/مرورگر یکتا
  @Column({ type: 'text', unique: true })
  endpoint!: string;

  @Column({ type: 'varchar', length: 200 })
  p256dh!: string;

  @Column({ type: 'varchar', length: 100 })
  auth!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
