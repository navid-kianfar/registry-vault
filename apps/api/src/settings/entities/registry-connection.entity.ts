import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RegistryType } from '@registry-vault/shared/enums';

@Entity('registry_connections')
export class RegistryConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  registryType!: RegistryType;

  @Column()
  name!: string;

  @Column()
  url!: string;

  @Column({ default: false })
  isDefault!: boolean;

  @Column({ default: false })
  isConnected!: boolean;

  @Column({ nullable: true })
  username?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
