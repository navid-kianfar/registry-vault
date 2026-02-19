import { IEntity } from './common.interfaces';
import { Role, Permission, RegistryType } from '../enums';

export interface IUser extends IEntity {
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: Role;
  isActive: boolean;
  lastLoginAt?: string;
  teamIds: string[];
}

export interface ITeam extends IEntity {
  name: string;
  description?: string;
  memberCount: number;
  memberIds: string[];
}

export interface ITeamMember {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  role: Role;
}

export interface IRoleDefinition {
  role: Role;
  label: string;
  description: string;
  permissions: Permission[];
}

export interface IPermissionGrant {
  id: string;
  subjectType: 'user' | 'team';
  subjectId: string;
  registryType: RegistryType;
  repositoryPattern?: string;
  permissions: Permission[];
}
