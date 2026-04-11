import { IEntity } from './common.interfaces';
import { AuditAction, RegistryType } from '../enums';

export interface IAuditLogEntry extends IEntity {
  action: AuditAction;
  actorId: string;
  actorUsername: string;
  registryType?: RegistryType;
  resourceType: string;
  resourceName: string;
  details?: string;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
}
