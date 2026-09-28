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
  @Column({ type: 'varchar', nullable: true })
  username?: string | null;

  /**
   * Secret value: password for BasicAuth, token for BearerToken, key for ApiKey.
   * Nullable on purpose — clearing it has to write NULL, and TypeORM's save()
   * skips a property set to undefined, which would leave the old secret behind.
   */
  @Column({ type: 'varchar', nullable: true })
  encryptedPassword?: string | null;

  /** Custom header name — for ApiKey auth type */
  @Column({ type: 'varchar', nullable: true })
  headerName?: string | null;

  @Column({ nullable: true })
  lastUsedAt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
