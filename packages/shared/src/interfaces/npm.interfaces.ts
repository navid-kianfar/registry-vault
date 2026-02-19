import { IEntity } from './common.interfaces';

export interface INpmPackage extends IEntity {
  name: string;
  description: string;
  latestVersion: string;
  author?: string;
  license?: string;
  totalDownloads: number;
  keywords: string[];
  repository?: string;
  homepage?: string;
  readmeContent?: string;
  distTags: Record<string, string>;
  registryConnectionId?: string;
}

export interface INpmPackageVersion {
  version: string;
  publishedAt: string;
  downloads: number;
  sizeBytes: number;
  unpackedSizeBytes: number;
  shasum: string;
  integrity: string;
  nodeEngine?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}
