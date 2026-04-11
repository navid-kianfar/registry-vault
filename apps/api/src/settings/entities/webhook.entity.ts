import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RegistryType, WebhookEvent } from '@registry-vault/shared/enums';

@Entity('webhooks')
export class WebhookEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  url!: string;

  @Column({ type: 'simple-json', nullable: true })
  events?: WebhookEvent[];

  @Column({ type: 'int', nullable: true })
  registryType?: RegistryType;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ nullable: true })
  secret?: string;

  @Column({ nullable: true })
  lastTriggeredAt?: string;

  @Column({ type: 'int', nullable: true })
  lastStatusCode?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
