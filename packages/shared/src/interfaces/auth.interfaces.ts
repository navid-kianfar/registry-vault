import { Role } from '../enums';

export interface IAuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl?: string;
}

export interface ILoginRequest {
  username: string;
  password: string;
}

export interface ILoginResponse {
  user: IAuthUser;
  token: string;
  expiresAt: string;
}

export interface IRegistryCredential {
  id: string;
  registryConnectionId: string;
  registryName: string;
  username: string;
  /** Password is write-only — never returned from the API */
  password?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface ICreateCredentialRequest {
  registryConnectionId: string;
  username: string;
  password: string;
}

export interface IUpdateCredentialRequest {
  username?: string;
  password?: string;
}
