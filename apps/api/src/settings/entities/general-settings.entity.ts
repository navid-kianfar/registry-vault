import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('general_settings')
export class GeneralSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ default: 'Registry Vault' })
  instanceName!: string;

  @Column({ default: 'http://localhost:3001' })
  instanceUrl!: string;

  @Column({ default: false })
  allowSelfRegistration!: boolean;

  @Column({ type: 'int', default: 2 })
  defaultRole!: number;

  @Column({ type: 'int', default: 60 })
  sessionTimeoutMinutes!: number;

  @Column({ default: false })
  maintenanceMode!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
