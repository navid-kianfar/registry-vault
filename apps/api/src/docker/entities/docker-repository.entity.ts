import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { DockerTagEntity } from './docker-tag.entity';

@Entity('docker_repositories')
export class DockerRepositoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'int', default: 0 })
  tagCount!: number;

  @Column({ type: 'int', default: 0 })
  totalPulls!: number;

  @Column({ type: 'bigint', default: 0 })
  totalSize!: number;

  @Column({ nullable: true })
  lastPushedAt?: string;

  @Column({ default: false })
  isPublic!: boolean;

  @Column({ nullable: true })
  registryConnectionId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => DockerTagEntity, (tag) => tag.repository)
  tags?: DockerTagEntity[];
}
