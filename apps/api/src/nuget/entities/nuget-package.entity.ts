import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { NuGetPackageVersionEntity } from './nuget-package-version.entity';

@Entity('nuget_packages')
export class NuGetPackageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  packageId!: string;

  @Column({ nullable: true })
  title?: string;

  @Column({ type: 'simple-json', nullable: true })
  authors?: string[];

  @Column('text', { nullable: true })
  description?: string;

  @Column()
  latestVersion!: string;

  @Column({ type: 'int', default: 0 })
  totalDownloads!: number;

  @Column({ default: false })
  isPrerelease!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  tags?: string[];

  @Column({ nullable: true })
  projectUrl?: string;

  @Column({ nullable: true })
  licenseExpression?: string;

  @Column({ nullable: true })
  iconUrl?: string;

  @Column({ nullable: true })
  registryConnectionId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => NuGetPackageVersionEntity, (version) => version.nugetPackage)
  versions?: NuGetPackageVersionEntity[];
}
