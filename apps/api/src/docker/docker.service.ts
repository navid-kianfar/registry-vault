import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  IDockerRepository,
  IDockerTag,
  IDockerImageDetail,
  PaginatedResponse,
  IVulnerabilitySummary,
} from '@registry-vault/shared';
import { DockerRepositoryEntity } from './entities/docker-repository.entity';
import { DockerTagEntity } from './entities/docker-tag.entity';
import { DockerImageDetailEntity } from './entities/docker-image-detail.entity';
import { paginate } from '../common/helpers/pagination.helper';

@Injectable()
export class DockerService {
  constructor(
    @InjectRepository(DockerRepositoryEntity)
    private readonly repositoryRepo: Repository<DockerRepositoryEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly tagRepo: Repository<DockerTagEntity>,
    @InjectRepository(DockerImageDetailEntity)
    private readonly imageDetailRepo: Repository<DockerImageDetailEntity>,
  ) {}

  async getRepositories(params: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    query?: string;
    registryConnectionId?: string;
  }): Promise<PaginatedResponse<IDockerRepository>> {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;
    const sortBy = params.sortBy || 'name';
    const sortOrder = (params.sortOrder || 'asc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.repositoryRepo.createQueryBuilder('repo');

    if (params.query) {
      qb.andWhere('repo.name LIKE :query', { query: `%${params.query}%` });
    }

    if (params.registryConnectionId) {
      qb.andWhere('repo.registryConnectionId = :registryConnectionId', {
        registryConnectionId: params.registryConnectionId,
      });
    }

    qb.orderBy(`repo.${sortBy}`, sortOrder);

    const result = await paginate(qb, page, pageSize);

    return {
      ...result,
      items: result.items.map((entity) => this.mapRepositoryToInterface(entity)),
    };
  }

  async getRepository(id: string): Promise<IDockerRepository> {
    const entity = await this.repositoryRepo.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(`Docker repository with id "${id}" not found`);
    }

    return this.mapRepositoryToInterface(entity);
  }

  async getTags(
    repositoryId: string,
    params: { page?: number; pageSize?: number },
  ): Promise<PaginatedResponse<IDockerTag>> {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;

    const qb = this.tagRepo.createQueryBuilder('tag')
      .where('tag.repositoryId = :repositoryId', { repositoryId })
      .orderBy('tag.pushedAt', 'DESC');

    const result = await paginate(qb, page, pageSize);

    return {
      ...result,
      items: result.items.map((entity) => this.mapTagToInterface(entity)),
    };
  }

  async getImageDetail(repositoryId: string, tagName: string): Promise<IDockerImageDetail> {
    const entity = await this.imageDetailRepo.findOne({
      where: { repositoryId, tag: tagName },
    });

    if (!entity) {
      throw new NotFoundException(
        `Image detail for tag "${tagName}" in repository "${repositoryId}" not found`,
      );
    }

    return this.mapImageDetailToInterface(entity);
  }

  async deleteTag(repositoryId: string, tagName: string): Promise<void> {
    const tag = await this.tagRepo.findOne({
      where: { repositoryId, name: tagName },
    });

    if (!tag) {
      throw new NotFoundException(
        `Tag "${tagName}" in repository "${repositoryId}" not found`,
      );
    }

    await this.tagRepo.remove(tag);

    // Update the repository's tag count
    const repo = await this.repositoryRepo.findOne({ where: { id: repositoryId } });
    if (repo) {
      const tagCount = await this.tagRepo.count({ where: { repositoryId } });
      repo.tagCount = tagCount;
      await this.repositoryRepo.save(repo);
    }
  }

  private mapRepositoryToInterface(entity: DockerRepositoryEntity): IDockerRepository {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      tagCount: Number(entity.tagCount),
      totalPulls: Number(entity.totalPulls),
      totalSize: Number(entity.totalSize),
      lastPushedAt: entity.lastPushedAt ?? '',
      isPublic: entity.isPublic,
      registryConnectionId: entity.registryConnectionId,
      createdAt: entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt),
      updatedAt: entity.updatedAt instanceof Date
        ? entity.updatedAt.toISOString()
        : String(entity.updatedAt),
    };
  }

  private mapTagToInterface(entity: DockerTagEntity): IDockerTag {
    const vulnerabilitySummary: IVulnerabilitySummary =
      typeof entity.vulnerabilitySummary === 'string'
        ? JSON.parse(entity.vulnerabilitySummary)
        : entity.vulnerabilitySummary || {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            none: 0,
          };

    return {
      name: entity.name,
      digest: entity.digest,
      sizeBytes: Number(entity.sizeBytes),
      architecture: entity.architecture,
      os: entity.os,
      pushedAt: entity.pushedAt,
      lastPulledAt: entity.lastPulledAt,
      vulnerabilitySummary,
    };
  }

  private mapImageDetailToInterface(entity: DockerImageDetailEntity): IDockerImageDetail {
    return {
      repository: entity.repositoryId,
      tag: entity.tag,
      digest: entity.digest,
      architecture: entity.architecture,
      os: entity.os,
      sizeBytes: Number(entity.sizeBytes),
      layers: typeof entity.layers === 'string' ? JSON.parse(entity.layers) : entity.layers || [],
      labels: typeof entity.labels === 'string' ? JSON.parse(entity.labels) : entity.labels || {},
      exposedPorts: typeof entity.exposedPorts === 'string'
        ? JSON.parse(entity.exposedPorts)
        : entity.exposedPorts,
      entrypoint: typeof entity.entrypoint === 'string'
        ? JSON.parse(entity.entrypoint)
        : entity.entrypoint,
      cmd: typeof entity.cmd === 'string' ? JSON.parse(entity.cmd) : entity.cmd,
      env: typeof entity.env === 'string' ? JSON.parse(entity.env) : entity.env,
      createdAt: entity.imageCreatedAt ?? entity.createdAt.toISOString(),
    };
  }
}
