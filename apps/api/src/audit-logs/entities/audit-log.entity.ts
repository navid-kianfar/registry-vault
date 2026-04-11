import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuditAction, RegistryType } from '@registry-vault/shared/enums';

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  action!: AuditAction;

  @Column()
  actorId!: string;

  @Column()
  actorUsername!: string;

  @Column({ type: 'int', nullable: true })
  registryType?: RegistryType;

  @Column()
  resourceType!: string;

  @Column()
  resourceName!: string;

  @Column('text', { nullable: true })
  details?: string;

  @Column()
  ipAddress!: string;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ default: true })
  success!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
