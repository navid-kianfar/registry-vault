import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  INpmPackage,
  INpmPackageVersion,
  PaginatedResponse,
} from '@registry-vault/shared';
import { NpmPackageEntity } from './entities/npm-package.entity';
import { NpmPackageVersionEntity } from './entities/npm-package-version.entity';
import { paginate } from '../common/helpers/pagination.helper';

@Injectable()
export class NpmService {
  constructor(
    @InjectRepository(NpmPackageEntity)
    private readonly packageRepo: Repository<NpmPackageEntity>,
    @InjectRepository(NpmPackageVersionEntity)
    private readonly versionRepo: Repository<NpmPackageVersionEntity>,
  ) {}

  async getPackages(params: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    query?: string;
    registryConnectionId?: string;
  }): Promise<PaginatedResponse<INpmPackage>> {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;
    const sortBy = params.sortBy || 'name';
    const sortOrder = (params.sortOrder || 'asc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.packageRepo.createQueryBuilder('pkg');

    if (params.query) {
      qb.andWhere('pkg.name LIKE :query', { query: `%${params.query}%` });
    }

    if (params.registryConnectionId) {
      qb.andWhere('pkg.registryConnectionId = :registryConnectionId', {
        registryConnectionId: params.registryConnectionId,
      });
    }

    qb.orderBy(`pkg.${sortBy}`, sortOrder);

    const result = await paginate(qb, page, pageSize);

    return {
      ...result,
      items: result.items.map((entity) => this.mapPackageToInterface(entity)),
    };
  }

  async getPackage(name: string): Promise<INpmPackage> {
    const entity = await this.packageRepo.findOne({
      where: { name },
    });

    if (!entity) {
      throw new NotFoundException(`NPM package "${name}" not found`);
    }

    return this.mapPackageToInterface(entity);
  }

  async getVersions(name: string): Promise<INpmPackageVersion[]> {
    const pkg = await this.packageRepo.findOne({
      where: { name },
    });

    if (!pkg) {
      throw new NotFoundException(`NPM package "${name}" not found`);
    }

    const versions = await this.versionRepo.find({
      where: { packageId: pkg.id },
      order: { publishedAt: 'DESC' },
    });

    return versions.map((entity) => this.mapVersionToInterface(entity));
  }

  private mapPackageToInterface(entity: NpmPackageEntity): INpmPackage {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description ?? '',
      latestVersion: entity.latestVersion,
      author: entity.author,
      license: entity.license,
      totalDownloads: Number(entity.totalDownloads),
      keywords: typeof entity.keywords === 'string'
        ? JSON.parse(entity.keywords)
        : entity.keywords || [],
      repository: entity.repository,
      homepage: entity.homepage,
      readmeContent: entity.readmeContent,
      distTags: typeof entity.distTags === 'string'
        ? JSON.parse(entity.distTags)
        : entity.distTags || {},
      registryConnectionId: entity.registryConnectionId,
      createdAt: entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt),
      updatedAt: entity.updatedAt instanceof Date
        ? entity.updatedAt.toISOString()
        : String(entity.updatedAt),
    };
  }

  private mapVersionToInterface(entity: NpmPackageVersionEntity): INpmPackageVersion {
    return {
      version: entity.version,
      publishedAt: entity.publishedAt,
      downloads: Number(entity.downloads),
      sizeBytes: Number(entity.sizeBytes),
      unpackedSizeBytes: Number(entity.unpackedSizeBytes),
      shasum: entity.shasum,
      integrity: entity.integrity,
      nodeEngine: entity.nodeEngine,
      dependencies: typeof entity.dependencies === 'string'
        ? JSON.parse(entity.dependencies)
        : entity.dependencies || {},
      devDependencies: typeof entity.devDependencies === 'string'
        ? JSON.parse(entity.devDependencies)
        : entity.devDependencies || {},
      peerDependencies: typeof entity.peerDependencies === 'string'
        ? JSON.parse(entity.peerDependencies)
        : entity.peerDependencies || {},
    };
  }
}
