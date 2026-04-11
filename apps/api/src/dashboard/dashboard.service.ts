import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RegistryType,
  HealthStatus,
  AuditAction,
} from '@registry-vault/shared/enums';
import type {
  IDashboardStats,
  IStorageStat,
  IRegistryHealth,
  IActivityFeedItem,
} from '@registry-vault/shared/interfaces/dashboard.interfaces';

import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { AuditLogEntity } from '../audit-logs/entities/audit-log.entity';
import { UserEntity } from '../rbac/entities/user.entity';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepo: Repository<DockerRepositoryEntity>,
    @InjectRepository(NpmPackageEntity)
    private readonly npmPackageRepo: Repository<NpmPackageEntity>,
    @InjectRepository(NuGetPackageEntity)
    private readonly nugetPackageRepo: Repository<NuGetPackageEntity>,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepo: Repository<AuditLogEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  /**
   * Compute and return dashboard stats from the database.
   */
  async getStats(): Promise<IDashboardStats> {
    // Count total repositories (Docker)
    const totalRepositories = await this.dockerRepoRepo.count();

    // Count total packages (NPM + NuGet)
    const npmCount = await this.npmPackageRepo.count();
    const nugetCount = await this.nugetPackageRepo.count();
    const totalPackages = npmCount + nugetCount;

    // Sum of tagCount across all DockerRepository entities
    const tagCountResult = await this.dockerRepoRepo
      .createQueryBuilder('repo')
      .select('COALESCE(SUM(repo.tagCount), 0)', 'total')
      .getRawOne();
    const totalImageTags = parseInt(tagCountResult?.total || '0', 10);

    // Total pulls: sum of totalPulls across all Docker repos (set by registry sync)
    const dockerPullsResult = await this.dockerRepoRepo
      .createQueryBuilder('repo')
      .select('COALESCE(SUM(repo.totalPulls), 0)', 'total')
      .getRawOne();
    const totalPullsToday = parseInt(dockerPullsResult?.total || '0', 10);

    // Total pushes/downloads: sum of totalDownloads across NPM + NuGet packages
    const npmDownloadsResult = await this.npmPackageRepo
      .createQueryBuilder('pkg')
      .select('COALESCE(SUM(pkg.totalDownloads), 0)', 'total')
      .getRawOne();
    const nugetDownloadsResult = await this.nugetPackageRepo
      .createQueryBuilder('pkg')
      .select('COALESCE(SUM(pkg.totalDownloads), 0)', 'total')
      .getRawOne();
    const totalPushesToday =
      parseInt(npmDownloadsResult?.total || '0', 10) +
      parseInt(nugetDownloadsResult?.total || '0', 10);

    // Count total users
    const totalUsers = await this.userRepo.count();

    // Storage stats by registry type
    const storageStats = await this.computeStorageStats();

    // Registry health per connection
    const registryHealth = await this.computeRegistryHealth();

    return {
      totalRepositories,
      totalPackages,
      totalImageTags,
      totalPullsToday,
      totalPushesToday,
      totalUsers,
      storageStats,
      registryHealth,
    };
  }

  /**
   * Get recent activity feed items from audit logs.
   */
  async getRecentActivity(limit: number = 15): Promise<IActivityFeedItem[]> {
    const logs = await this.auditLogRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return logs.map((log) => ({
      id: log.id,
      action: AuditAction[log.action] || String(log.action),
      actorName: log.actorUsername,
      actorAvatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(log.actorUsername)}`,
      registryType:
        log.registryType !== undefined && log.registryType !== null
          ? log.registryType
          : RegistryType.Docker,
      resourceName: log.resourceName,
      timestamp:
        log.createdAt instanceof Date
          ? log.createdAt.toISOString()
          : String(log.createdAt),
    }));
  }

  /**
   * Compute storage stats aggregated per registry type.
   */
  private async computeStorageStats(): Promise<IStorageStat[]> {
    const stats: IStorageStat[] = [];

    // Docker storage
    const dockerSizeResult = await this.dockerRepoRepo
      .createQueryBuilder('repo')
      .select('COALESCE(SUM(repo.totalSize), 0)', 'totalSize')
      .addSelect('COALESCE(SUM(repo.totalPulls), 0)', 'totalDownloads')
      .addSelect('COUNT(*)', 'itemCount')
      .getRawOne();

    stats.push({
      registryType: RegistryType.Docker,
      usedBytes: parseInt(dockerSizeResult?.totalSize || '0', 10),
      totalBytes: 0, // Total capacity is not tracked per registry
      itemCount: parseInt(dockerSizeResult?.itemCount || '0', 10),
    });

    // NPM storage
    const npmSizeResult = await this.npmPackageRepo
      .createQueryBuilder('pkg')
      .select('COALESCE(SUM(pkg.totalDownloads), 0)', 'totalDownloads')
      .addSelect('COUNT(*)', 'itemCount')
      .getRawOne();

    stats.push({
      registryType: RegistryType.NPM,
      usedBytes: 0,
      totalBytes: 0,
      itemCount: parseInt(npmSizeResult?.itemCount || '0', 10),
    });

    // NuGet storage
    const nugetSizeResult = await this.nugetPackageRepo
      .createQueryBuilder('pkg')
      .select('COALESCE(SUM(pkg.totalDownloads), 0)', 'totalDownloads')
      .addSelect('COUNT(*)', 'itemCount')
      .getRawOne();

    stats.push({
      registryType: RegistryType.NuGet,
      usedBytes: 0,
      totalBytes: 0,
      itemCount: parseInt(nugetSizeResult?.itemCount || '0', 10),
    });

    return stats;
  }

  /**
   * Compute registry health for each connection.
   */
  private async computeRegistryHealth(): Promise<IRegistryHealth[]> {
    const connections = await this.connectionRepo.find();

    return connections.map((conn) => ({
      registryType: conn.registryType,
      status: conn.isConnected ? HealthStatus.Healthy : HealthStatus.Unhealthy,
      url: conn.url,
      lastCheckedAt: new Date().toISOString(),
      responseTimeMs: conn.isConnected ? 0 : -1,
      errorMessage: conn.isConnected
        ? undefined
        : 'Connection is not established',
    }));
  }
}
