import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ITeam, PaginatedResponse } from '@registry-vault/shared';
import { TeamEntity } from './entities/team.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(TeamEntity)
    private readonly teamRepository: Repository<TeamEntity>,
  ) {}

  async getTeams(params: {
    page: number;
    pageSize: number;
  }): Promise<PaginatedResponse<ITeam>> {
    const { page, pageSize } = params;
    const skip = (page - 1) * pageSize;

    const [entities, totalCount] = await this.teamRepository.findAndCount({
      relations: ['members'],
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      items: entities.map((entity) => this.mapToTeam(entity)),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async getTeam(id: string): Promise<ITeam> {
    const entity = await this.teamRepository.findOne({
      where: { id },
      relations: ['members'],
    });

    if (!entity) {
      throw new NotFoundException(`Team with id "${id}" not found`);
    }

    return this.mapToTeam(entity);
  }

  private mapToTeam(entity: TeamEntity): ITeam {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      memberCount: entity.memberCount,
      memberIds: entity.members ? entity.members.map((m) => m.id) : [],
      members: entity.members
        ? entity.members.map((m) => ({
            userId: m.id,
            username: m.username,
            displayName: m.displayName,
            avatarUrl: m.avatarUrl,
            role: m.role,
          }))
        : [],
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
