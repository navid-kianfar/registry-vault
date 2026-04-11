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

@Entity('docker_image_details')
export class DockerImageDetailEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  repositoryId!: string;

  @ManyToOne(() => DockerRepositoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository?: DockerRepositoryEntity;

  @Column()
  tag!: string;

  @Column()
  digest!: string;

  @Column()
  architecture!: string;

  @Column()
  os!: string;

  @Column({ type: 'bigint', default: 0 })
  sizeBytes!: number;

  @Column({ type: 'simple-json', nullable: true })
  layers?: Array<{
    digest: string;
    sizeBytes: number;
    command: string;
    createdAt: string;
  }>;

  @Column({ type: 'simple-json', nullable: true })
  labels?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  exposedPorts?: string[];

  @Column({ type: 'simple-json', nullable: true })
  entrypoint?: string[];

  @Column({ type: 'simple-json', nullable: true })
  cmd?: string[];

  @Column({ type: 'simple-json', nullable: true })
  env?: string[];

  @Column({ nullable: true })
  imageCreatedAt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
