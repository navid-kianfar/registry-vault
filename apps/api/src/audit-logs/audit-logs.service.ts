import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In, Like } from 'typeorm';
import type { IAuditLogEntry, PaginatedResponse } from '@registry-vault/shared';
import { AuditAction, RegistryType } from '@registry-vault/shared';
import { AuditLogEntity } from './entities/audit-log.entity';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
  ) {}

  async getAuditLogs(params: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    actions?: AuditAction[];
    registryType?: RegistryType;
    actorUsername?: string;
    resourceName?: string;
    from?: string;
    to?: string;
    success?: boolean;
  }): Promise<PaginatedResponse<IAuditLogEntry>> {
    const {
      page,
      pageSize,
      sortBy,
      sortOrder,
      actions,
      registryType,
      actorUsername,
      resourceName,
      from,
      to,
      success,
    } = params;

    const skip = (page - 1) * pageSize;

    const qb = this.auditLogRepository.createQueryBuilder('log');

    if (actions && actions.length > 0) {
      qb.andWhere('log.action IN (:...actions)', { actions });
    }

    if (registryType !== undefined) {
      qb.andWhere('log.registryType = :registryType', { registryType });
    }

    if (actorUsername) {
      qb.andWhere('log.actorUsername LIKE :actorUsername', {
        actorUsername: `%${actorUsername}%`,
      });
    }

    if (resourceName) {
      qb.andWhere('log.resourceName LIKE :resourceName', {
        resourceName: `%${resourceName}%`,
      });
    }

    if (from && to) {
      qb.andWhere('log.createdAt BETWEEN :from AND :to', {
        from: new Date(from),
        to: new Date(to),
      });
    } else if (from) {
      qb.andWhere('log.createdAt >= :from', { from: new Date(from) });
    } else if (to) {
      qb.andWhere('log.createdAt <= :to', { to: new Date(to) });
    }

    if (success !== undefined) {
      qb.andWhere('log.success = :success', { success });
    }

    qb.orderBy(`log.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC');
    qb.skip(skip).take(pageSize);

    const [entities, totalCount] = await qb.getManyAndCount();

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      items: entities.map((entity) => this.mapToAuditLogEntry(entity)),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async log(entry: {
    action: AuditAction;
    actorId: string;
    actorUsername: string;
    registryType?: RegistryType;
    resourceType: string;
    resourceName: string;
    details?: string;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
  }): Promise<void> {
    const entity = this.auditLogRepository.create();
    entity.action = entry.action;
    entity.actorId = entry.actorId;
    entity.actorUsername = entry.actorUsername;
    entity.registryType = entry.registryType ?? undefined;
    entity.resourceType = entry.resourceType;
    entity.resourceName = entry.resourceName;
    entity.details = entry.details;
    entity.ipAddress = entry.ipAddress || 'system';
    entity.userAgent = entry.userAgent;
    entity.success = entry.success ?? true;
    await this.auditLogRepository.save(entity);
  }

  private mapToAuditLogEntry(entity: AuditLogEntity): IAuditLogEntry {
    return {
      id: entity.id,
      action: entity.action,
      actorId: entity.actorId,
      actorUsername: entity.actorUsername,
      registryType: entity.registryType ?? undefined,
      resourceType: entity.resourceType,
      resourceName: entity.resourceName,
      details: entity.details ?? undefined,
      ipAddress: entity.ipAddress,
      userAgent: entity.userAgent ?? undefined,
      success: entity.success,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
