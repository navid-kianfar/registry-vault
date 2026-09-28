import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RegistryType } from '@registry-vault/shared/enums';

@Entity('retention_policies')
export class RetentionPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  registryType!: RegistryType;

  @Column()
  name!: string;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ type: 'int', nullable: true })
  keepLastN?: number;

  @Column({ type: 'int', nullable: true })
  olderThanDays?: number;

  @Column({ nullable: true })
  tagPatternExclude?: string;

  /** Docker only: delete tags nobody pulled for this many days. Needs an agent. */
  @Column({ type: 'int', nullable: true })
  notPulledForDays?: number;

  /** Docker only: garbage-collect afterwards on every registry the run deleted from. */
  @Column({ default: false })
  runGcAfter!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
