import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NuGetPackageEntity } from './nuget-package.entity';

@Entity('nuget_package_versions')
export class NuGetPackageVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  nugetPackageId!: string;

  @Column()
  version!: string;

  @Column({ type: 'int', default: 0 })
  downloads!: number;

  @Column()
  publishedAt!: string;

  @Column({ default: false })
  isPrerelease!: boolean;

  @Column({ default: true })
  isListed!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  dependencies?: Array<{
    targetFramework: string;
    dependencies: Array<{
      id: string;
      versionRange: string;
    }>;
  }>;

  @Column({ type: 'bigint', default: 0 })
  sizeBytes!: number;

  @Column({ nullable: true })
  packageHash?: string;

  @Column({ nullable: true })
  packageHashAlgorithm?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => NuGetPackageEntity, (pkg) => pkg.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'nugetPackageId' })
  nugetPackage?: NuGetPackageEntity;
}
