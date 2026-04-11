import { IEntity } from './common.interfaces';
import { VulnerabilitySeverity } from '../enums';

export interface IDockerRepository extends IEntity {
  name: string;
  description?: string;
  tagCount: number;
  totalPulls: number;
  totalSize: number;
  lastPushedAt: string;
  isPublic: boolean;
  registryConnectionId?: string;
}

export interface IDockerTag {
  name: string;
  digest: string;
  sizeBytes: number;
  architecture: string;
  os: string;
  pushedAt: string;
  lastPulledAt?: string;
  vulnerabilitySummary: IVulnerabilitySummary;
}

export interface IVulnerabilitySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  none: number;
  lastScannedAt?: string;
}

export interface IVulnerability {
  id: string;
  severity: VulnerabilitySeverity;
  package: string;
  installedVersion: string;
  fixedVersion?: string;
  title: string;
  description: string;
  url?: string;
}

export interface IDockerImageLayer {
  digest: string;
  sizeBytes: number;
  command: string;
  createdAt: string;
}

export interface IDockerImageDetail {
  repository: string;
  tag: string;
  digest: string;
  architecture: string;
  os: string;
  sizeBytes: number;
  layers: IDockerImageLayer[];
  labels: Record<string, string>;
  exposedPorts?: string[];
  entrypoint?: string[];
  cmd?: string[];
  env?: string[];
  createdAt: string;
}
