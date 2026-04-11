import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  IAnalyticsSummary,
  IRegistryAnalytics,
  IAnalyticsDataPoint,
  ITopPackage,
} from '@registry-vault/shared';
import { RegistryType, AuditAction } from '@registry-vault/shared';
import { AuditLogEntity } from '../audit-logs/entities/audit-log.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepository: Repository<DockerRepositoryEntity>,
    @InjectRepository(NpmPackageEntity)
    private readonly npmPackageRepository: Repository<NpmPackageEntity>,
    @InjectRepository(NuGetPackageEntity)
    private readonly nugetPackageRepository: Repository<NuGetPackageEntity>,
  ) {}

  async getAnalyticsSummary(filter: {
    registryTypes?: RegistryType[];
    dateRange: { from?: string; to?: string };
    granularity: 'day' | 'week' | 'month';
  }): Promise<IAnalyticsSummary> {
    const registryTypes = filter.registryTypes && filter.registryTypes.length > 0
      ? filter.registryTypes
      : [RegistryType.Docker, RegistryType.NuGet, RegistryType.NPM];

    const from = filter.dateRange.from
      ? new Date(filter.dateRange.from)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = filter.dateRange.to ? new Date(filter.dateRange.to) : new Date();

    const timeRangeLabel = this.buildTimeRangeLabel(from, to);

    const registryAnalytics: IRegistryAnalytics[] = [];

    for (const registryType of registryTypes) {
      const analytics = await this.getRegistryAnalytics(
        registryType,
        from,
        to,
        filter.granularity,
      );
      registryAnalytics.push(analytics);
    }

    const topPackages = await this.getTopPackages(registryTypes);

    return {
      timeRangeLabel,
      registryAnalytics,
      topPackages,
    };
  }

  private async getRegistryAnalytics(
    registryType: RegistryType,
    from: Date,
    to: Date,
    granularity: 'day' | 'week' | 'month',
  ): Promise<IRegistryAnalytics> {
    const pullActions = this.getPullActions(registryType);
    const pushActions = this.getPushActions(registryType);

    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .where('log.registryType = :registryType', { registryType })
      .andWhere('log.createdAt BETWEEN :from AND :to', { from, to })
      .andWhere('log.success = :success', { success: true });

    const logs = await qb.getMany();

    const dataPointsMap = new Map<string, { pulls: number; pushes: number }>();
    const dateKeys = this.generateDateKeys(from, to, granularity);

    for (const key of dateKeys) {
      dataPointsMap.set(key, { pulls: 0, pushes: 0 });
    }

    for (const log of logs) {
      const dateKey = this.getDateKey(log.createdAt, granularity);
      const point = dataPointsMap.get(dateKey);
      if (point) {
        if (pullActions.includes(log.action)) {
          point.pulls += 1;
        }
        if (pushActions.includes(log.action)) {
          point.pushes += 1;
        }
      }
    }

    const dataPoints: IAnalyticsDataPoint[] = [];
    let totalPulls = 0;
    let totalPushes = 0;

    for (const [date, counts] of dataPointsMap) {
      dataPoints.push({ date, pulls: counts.pulls, pushes: counts.pushes });
      totalPulls += counts.pulls;
      totalPushes += counts.pushes;
    }

    return {
      registryType,
      dataPoints,
      totalPulls,
      totalPushes,
    };
  }

  private async getTopPackages(registryTypes: RegistryType[]): Promise<ITopPackage[]> {
    const topPackages: ITopPackage[] = [];

    if (registryTypes.includes(RegistryType.Docker)) {
      const dockerRepos = await this.dockerRepoRepository.find({
        order: { totalPulls: 'DESC' },
        take: 5,
      });
      for (const repo of dockerRepos) {
        topPackages.push({
          registryType: RegistryType.Docker,
          name: repo.name,
          downloads: Number(repo.totalPulls),
        });
      }
    }

    if (registryTypes.includes(RegistryType.NPM)) {
      const npmPackages = await this.npmPackageRepository.find({
        order: { totalDownloads: 'DESC' },
        take: 5,
      });
      for (const pkg of npmPackages) {
        topPackages.push({
          registryType: RegistryType.NPM,
          name: pkg.name,
          downloads: Number(pkg.totalDownloads),
        });
      }
    }

    if (registryTypes.includes(RegistryType.NuGet)) {
      const nugetPackages = await this.nugetPackageRepository.find({
        order: { totalDownloads: 'DESC' },
        take: 5,
      });
      for (const pkg of nugetPackages) {
        topPackages.push({
          registryType: RegistryType.NuGet,
          name: pkg.packageId,
          downloads: Number(pkg.totalDownloads),
        });
      }
    }

    topPackages.sort((a, b) => b.downloads - a.downloads);

    return topPackages.slice(0, 10);
  }

  private getPullActions(registryType: RegistryType): AuditAction[] {
    switch (registryType) {
      case RegistryType.Docker:
        return [AuditAction.ImagePull];
      case RegistryType.NPM:
      case RegistryType.NuGet:
        return [AuditAction.PackageDownload];
      default:
        return [];
    }
  }

  private getPushActions(registryType: RegistryType): AuditAction[] {
    switch (registryType) {
      case RegistryType.Docker:
        return [AuditAction.ImagePush];
      case RegistryType.NPM:
      case RegistryType.NuGet:
        return [AuditAction.PackagePublish];
      default:
        return [];
    }
  }

  private generateDateKeys(from: Date, to: Date, granularity: 'day' | 'week' | 'month'): string[] {
    const keys: string[] = [];
    const current = new Date(from);

    while (current <= to) {
      keys.push(this.formatDateKey(current, granularity));

      switch (granularity) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
      }
    }

    return keys;
  }

  private getDateKey(date: Date, granularity: 'day' | 'week' | 'month'): string {
    return this.formatDateKey(date, granularity);
  }

  private formatDateKey(date: Date, granularity: 'day' | 'week' | 'month'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    switch (granularity) {
      case 'day':
        return `${year}-${month}-${day}`;
      case 'week': {
        // Align to start of week (Monday)
        const weekStart = new Date(date);
        const dayOfWeek = weekStart.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        weekStart.setDate(weekStart.getDate() + diff);
        const wy = weekStart.getFullYear();
        const wm = String(weekStart.getMonth() + 1).padStart(2, '0');
        const wd = String(weekStart.getDate()).padStart(2, '0');
        return `${wy}-${wm}-${wd}`;
      }
      case 'month':
        return `${year}-${month}-01`;
    }
  }

  private buildTimeRangeLabel(from: Date, to: Date): string {
    const diffDays = Math.ceil(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays <= 1) return 'Last 24 hours';
    if (diffDays <= 7) return 'Last 7 days';
    if (diffDays <= 30) return 'Last 30 days';
    if (diffDays <= 90) return 'Last 90 days';
    return `${from.toISOString().split('T')[0]} to ${to.toISOString().split('T')[0]}`;
  }
}
