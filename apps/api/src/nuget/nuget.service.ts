import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  INuGetPackage,
  INuGetPackageVersion,
  PaginatedResponse,
} from '@registry-vault/shared';
import { NuGetPackageEntity } from './entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from './entities/nuget-package-version.entity';
import { paginate } from '../common/helpers/pagination.helper';

@Injectable()
export class NuGetService {
  constructor(
    @InjectRepository(NuGetPackageEntity)
    private readonly packageRepo: Repository<NuGetPackageEntity>,
    @InjectRepository(NuGetPackageVersionEntity)
    private readonly versionRepo: Repository<NuGetPackageVersionEntity>,
  ) {}

  async getPackages(params: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    query?: string;
    registryConnectionId?: string;
  }): Promise<PaginatedResponse<INuGetPackage>> {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;
    const sortBy = params.sortBy || 'packageId';
    const sortOrder = (params.sortOrder || 'asc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.packageRepo.createQueryBuilder('pkg');

    if (params.query) {
      qb.andWhere(
        '(pkg.packageId LIKE :query OR pkg.title LIKE :query OR pkg.description LIKE :query)',
        { query: `%${params.query}%` },
      );
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

  async getPackage(id: string): Promise<INuGetPackage> {
    const entity = await this.packageRepo.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(`NuGet package with id "${id}" not found`);
    }

    return this.mapPackageToInterface(entity);
  }

  async getVersions(packageId: string): Promise<INuGetPackageVersion[]> {
    const pkg = await this.packageRepo.findOne({
      where: { id: packageId },
    });

    if (!pkg) {
      throw new NotFoundException(`NuGet package with id "${packageId}" not found`);
    }

    const versions = await this.versionRepo.find({
      where: { nugetPackageId: packageId },
      order: { publishedAt: 'DESC' },
    });

    return versions.map((entity) => this.mapVersionToInterface(entity));
  }

  private mapPackageToInterface(entity: NuGetPackageEntity): INuGetPackage {
    return {
      id: entity.id,
      packageId: entity.packageId,
      title: entity.title,
      authors: typeof entity.authors === 'string'
        ? JSON.parse(entity.authors)
        : entity.authors || [],
      description: entity.description ?? '',
      latestVersion: entity.latestVersion,
      totalDownloads: Number(entity.totalDownloads),
      isPrerelease: entity.isPrerelease,
      tags: typeof entity.tags === 'string'
        ? JSON.parse(entity.tags)
        : entity.tags || [],
      projectUrl: entity.projectUrl,
      licenseExpression: entity.licenseExpression,
      iconUrl: entity.iconUrl,
      registryConnectionId: entity.registryConnectionId,
      createdAt: entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt),
      updatedAt: entity.updatedAt instanceof Date
        ? entity.updatedAt.toISOString()
        : String(entity.updatedAt),
    };
  }

  private mapVersionToInterface(entity: NuGetPackageVersionEntity): INuGetPackageVersion {
    return {
      version: entity.version,
      downloads: Number(entity.downloads),
      publishedAt: entity.publishedAt,
      isPrerelease: entity.isPrerelease,
      isListed: entity.isListed,
      dependencies: typeof entity.dependencies === 'string'
        ? JSON.parse(entity.dependencies)
        : entity.dependencies || [],
      sizeBytes: Number(entity.sizeBytes),
      packageHash: entity.packageHash ?? '',
      packageHashAlgorithm: entity.packageHashAlgorithm ?? '',
    };
  }
}
