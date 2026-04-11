import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NpmPackageEntity } from './npm-package.entity';

@Entity('npm_package_versions')
export class NpmPackageVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  packageId!: string;

  @Column()
  version!: string;

  @Column()
  publishedAt!: string;

  @Column({ type: 'int', default: 0 })
  downloads!: number;

  @Column({ type: 'bigint', default: 0 })
  sizeBytes!: number;

  @Column({ type: 'bigint', default: 0 })
  unpackedSizeBytes!: number;

  @Column()
  shasum!: string;

  @Column()
  integrity!: string;

  @Column({ nullable: true })
  nodeEngine?: string;

  @Column({ type: 'simple-json', nullable: true })
  dependencies?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  devDependencies?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  peerDependencies?: Record<string, string>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => NpmPackageEntity, (pkg) => pkg.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'packageId' })
  npmPackage?: NpmPackageEntity;
}
