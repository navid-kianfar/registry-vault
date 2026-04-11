import { IEntity } from './common.interfaces';

export interface INuGetPackage extends IEntity {
  packageId: string;
  title?: string;
  authors: string[];
  description: string;
  latestVersion: string;
  totalDownloads: number;
  isPrerelease: boolean;
  tags: string[];
  projectUrl?: string;
  licenseExpression?: string;
  iconUrl?: string;
  registryConnectionId?: string;
}

export interface INuGetPackageVersion {
  version: string;
  downloads: number;
  publishedAt: string;
  isPrerelease: boolean;
  isListed: boolean;
  dependencies: INuGetDependencyGroup[];
  sizeBytes: number;
  packageHash: string;
  packageHashAlgorithm: string;
}

export interface INuGetDependencyGroup {
  targetFramework: string;
  dependencies: INuGetDependency[];
}

export interface INuGetDependency {
  id: string;
  versionRange: string;
}
