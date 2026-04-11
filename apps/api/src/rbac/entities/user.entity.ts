import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Role } from '@registry-vault/shared/enums';
import { TeamEntity } from './team.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  displayName!: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ type: 'int', default: Role.Reader })
  role!: Role;

  @Column({ default: true })
  isActive!: boolean;

  @Column()
  passwordHash!: string;

  @Column({ nullable: true })
  lastLoginAt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToMany(() => TeamEntity, (team) => team.members)
  @JoinTable({
    name: 'user_teams',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'teamId', referencedColumnName: 'id' },
  })
  teams?: TeamEntity[];
}
