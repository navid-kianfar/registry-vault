import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DockerRepositoryEntity } from './docker-repository.entity';

@Entity('docker_tags')
export class DockerTagEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  repositoryId!: string;

  @Column()
  name!: string;

  @Column()
  digest!: string;

  @Column({ type: 'bigint', default: 0 })
  sizeBytes!: number;

  @Column()
  architecture!: string;

  @Column()
  os!: string;

  @Column()
  pushedAt!: string;

  @Column({ nullable: true })
  lastPulledAt?: string;

  @Column({ type: 'simple-json', nullable: true })
  vulnerabilitySummary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    none: number;
    lastScannedAt?: string;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => DockerRepositoryEntity, (repo) => repo.tags, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'repositoryId' })
  repository?: DockerRepositoryEntity;
}
