import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Not, FindOptionsWhere } from 'typeorm';
import * as bcrypt from 'bcrypt';
import type { IUser, ICreateUserRequest, IUpdateUserRequest, PaginatedResponse } from '@registry-vault/shared';
import { Role } from '@registry-vault/shared/enums';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async getUsers(params: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    query?: string;
  }): Promise<PaginatedResponse<IUser>> {
    const { page, pageSize, sortBy, sortOrder, query } = params;
    const skip = (page - 1) * pageSize;

    const where: FindOptionsWhere<UserEntity>[] | undefined = query
      ? [
          { username: Like(`%${query}%`) },
          { email: Like(`%${query}%`) },
          { displayName: Like(`%${query}%`) },
        ]
      : undefined;

    const [entities, totalCount] = await this.userRepository.findAndCount({
      where,
      relations: ['teams'],
      order: { [sortBy]: sortOrder },
      skip,
      take: pageSize,
    });

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      items: entities.map((entity) => this.mapToUser(entity)),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async getUser(id: string): Promise<IUser> {
    const entity = await this.userRepository.findOne({
      where: { id },
      relations: ['teams'],
    });

    if (!entity) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return this.mapToUser(entity);
  }

  async createUser(request: ICreateUserRequest): Promise<IUser> {
    const existingByUsername = await this.userRepository.findOne({
      where: { username: request.username },
    });
    if (existingByUsername) {
      throw new BadRequestException(`Username "${request.username}" is already taken`);
    }

    const existingByEmail = await this.userRepository.findOne({
      where: { email: request.email },
    });
    if (existingByEmail) {
      throw new BadRequestException(`Email "${request.email}" is already in use`);
    }

    const passwordHash = await bcrypt.hash(request.password, 10);
    const entity = this.userRepository.create({
      username: request.username,
      email: request.email,
      displayName: request.displayName,
      role: request.role,
      isActive: true,
      passwordHash,
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(request.displayName.slice(0, 2).toUpperCase())}`,
    });

    const saved = await this.userRepository.save(entity);
    return this.mapToUser(saved);
  }

  async updateUser(id: string, request: IUpdateUserRequest): Promise<IUser> {
    const entity = await this.userRepository.findOne({
      where: { id },
      relations: ['teams'],
    });

    if (!entity) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    const isDemotion = request.role !== undefined && request.role !== Role.Admin;
    const isDeactivation = request.isActive === false;
    if (isDemotion || isDeactivation) {
      await this.requireAnotherAdminRemains(entity, isDemotion ? 'demoted' : 'deactivated');
    }

    if (request.email !== undefined) entity.email = request.email;
    if (request.displayName !== undefined) entity.displayName = request.displayName;
    if (request.role !== undefined) entity.role = request.role;
    if (request.isActive !== undefined) entity.isActive = request.isActive;

    const saved = await this.userRepository.save(entity);
    return this.mapToUser(saved);
  }

  async deleteUser(id: string): Promise<void> {
    const entity = await this.userRepository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    await this.requireAnotherAdminRemains(entity, 'deleted');

    await this.userRepository.remove(entity);
  }

  /** Change your own password, proving you know the current one. */
  async changeOwnPassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const entity = await this.findUserOrFail(id);

    if (!currentPassword) {
      throw new BadRequestException('The current password is required to change your own password');
    }

    const isValid = await bcrypt.compare(currentPassword, entity.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.writePasswordHash(entity, newPassword);
  }

  /** Reset another user's password as an administrator, who cannot know the old one. */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    const entity = await this.findUserOrFail(id);
    await this.writePasswordHash(entity, newPassword);
  }

  private async findUserOrFail(id: string): Promise<UserEntity> {
    const entity = await this.userRepository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return entity;
  }

  private async writePasswordHash(entity: UserEntity, newPassword: string): Promise<void> {
    if (!newPassword) {
      throw new BadRequestException('A new password is required');
    }

    entity.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(entity);
  }

  /**
   * Refuse to remove the last administrator who can still sign in.
   *
   * An instance with no active admin cannot be administered at all: nobody can
   * create one, because creating users is itself admin-only. Recovering from
   * that needs database surgery, so it is worth a 400.
   */
  private async requireAnotherAdminRemains(
    entity: UserEntity,
    change: string,
  ): Promise<void> {
    if (entity.role !== Role.Admin || !entity.isActive) return;

    const otherAdmins = await this.userRepository.count({
      where: { role: Role.Admin, isActive: true, id: Not(entity.id) },
    });

    if (otherAdmins === 0) {
      throw new BadRequestException(
        `"${entity.username}" is the last active administrator and cannot be ${change} — make another user an administrator first`,
      );
    }
  }

  private mapToUser(entity: UserEntity): IUser {
    return {
      id: entity.id,
      username: entity.username,
      email: entity.email,
      displayName: entity.displayName,
      avatarUrl: entity.avatarUrl,
      role: entity.role,
      isActive: entity.isActive,
      lastLoginAt: entity.lastLoginAt ?? undefined,
      teamIds: entity.teams ? entity.teams.map((t) => t.id) : [],
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
