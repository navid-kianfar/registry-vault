import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScanState, IScanFinding } from '@registry-vault/shared';

/**
 * A Trivy scan the agent ran, with its findings. The tag row keeps only the
 * counts; the full finding list lives here so a tag listing stays small.
 */
@Entity('docker_scan_results')
@Index(['repositoryId', 'tagName'])
export class DockerScanResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  repositoryId!: string;

  @Column()
  tagName!: string;

  /** The agent's own scan id, followed until the job finishes. */
  @Column()
  @Index()
  scanId!: string;

  @Column()
  registryConnectionId!: string;

  @Column({ nullable: true })
  digest?: string;

  @Column()
  platform!: string;

  // An explicit column type: TypeORM cannot infer one from a string union.
  @Column({ type: 'varchar' })
  state!: ScanState;

  @Column()
  queuedAt!: string;

  @Column({ nullable: true })
  startedAt?: string;

  @Column({ nullable: true })
  finishedAt?: string;

  @Column('text', { nullable: true })
  error?: string;

  @Column({ type: 'simple-json', nullable: true })
  summary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };

  @Column({ type: 'simple-json', nullable: true })
  vulnerabilities?: IScanFinding[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
