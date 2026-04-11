import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CredentialAuthType } from '@registry-vault/shared/enums';

@Entity('registry_credentials')
export class RegistryCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  registryConnectionId!: string;

  @Column()
  registryName!: string;

  /** Auth strategy for this credential */
  @Column({ type: 'int', default: CredentialAuthType.BasicAuth })
  authType!: CredentialAuthType;

  /** Username — for BasicAuth */
  @Column({ nullable: true })
  username?: string;

  /** Secret value: password for BasicAuth, token for BearerToken, key for ApiKey */
  @Column({ nullable: true })
  encryptedPassword?: string;

  /** Custom header name — for ApiKey auth type */
  @Column({ nullable: true })
  headerName?: string;

  @Column({ nullable: true })
  lastUsedAt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
