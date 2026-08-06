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
  /** Digest the tag resolves to — the index digest for a multi-arch tag. */
  digest: string;
  sizeBytes: number;
  /** Architecture of the primary platform; see `platforms` for the full set. */
  architecture: string;
  os: string;
  /** Every platform published under this tag. Single-platform tags list one. */
  platforms: IDockerPlatform[];
  pushedAt: string;
  lastPulledAt?: string;
  vulnerabilitySummary: IVulnerabilitySummary;
}

/** One platform-specific image inside a tag (an entry of the OCI index). */
export interface IDockerPlatform {
  architecture: string;
  os: string;
  /** e.g. `v7` for linux/arm/v7 */
  variant?: string;
  /** Digest of this platform's own manifest. */
  digest: string;
  sizeBytes: number;
  /** Build attestation entries rather than runnable images. */
  isAttestation?: boolean;
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
  /** Architecture of the platform the layer/config details below come from. */
  architecture: string;
  os: string;
  /** Every platform published under this tag. */
  platforms: IDockerPlatform[];
  sizeBytes: number;
  layers: IDockerImageLayer[];
  labels: Record<string, string>;
  exposedPorts?: string[];
  entrypoint?: string[];
  cmd?: string[];
  env?: string[];
  createdAt: string;
}
