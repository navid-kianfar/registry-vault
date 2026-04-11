import { Role, CredentialAuthType } from '../enums';

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
  authType: CredentialAuthType;
  /** Username — used for BasicAuth */
  username?: string;
  /** Header name — used for ApiKey (e.g. "X-NuGet-ApiKey") */
  headerName?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface ICreateCredentialRequest {
  registryConnectionId: string;
  authType: CredentialAuthType;
  /** Username for BasicAuth */
  username?: string;
  /** Secret value: password for BasicAuth, token for BearerToken, key for ApiKey */
  password?: string;
  /** Header name for ApiKey auth type */
  headerName?: string;
}

export interface IUpdateCredentialRequest {
  authType?: CredentialAuthType;
  username?: string;
  password?: string;
  headerName?: string;
}
