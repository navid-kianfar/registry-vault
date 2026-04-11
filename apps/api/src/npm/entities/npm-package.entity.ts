import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { NpmPackageVersionEntity } from './npm-package-version.entity';

@Entity('npm_packages')
export class NpmPackageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column()
  latestVersion!: string;

  @Column({ nullable: true })
  author?: string;

  @Column({ nullable: true })
  license?: string;

  @Column({ type: 'int', default: 0 })
  totalDownloads!: number;

  @Column({ type: 'simple-json', nullable: true })
  keywords?: string[];

  @Column({ nullable: true })
  repository?: string;

  @Column({ nullable: true })
  homepage?: string;

  @Column('text', { nullable: true })
  readmeContent?: string;

  @Column({ type: 'simple-json', nullable: true })
  distTags?: Record<string, string>;

  @Column({ nullable: true })
  registryConnectionId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => NpmPackageVersionEntity, (version) => version.npmPackage)
  versions?: NpmPackageVersionEntity[];
}
