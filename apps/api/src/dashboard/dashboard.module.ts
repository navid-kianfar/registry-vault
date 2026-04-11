import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { AuditLogEntity } from '../audit-logs/entities/audit-log.entity';
import { UserEntity } from '../rbac/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DockerRepositoryEntity,
      NpmPackageEntity,
      NuGetPackageEntity,
      RegistryConnectionEntity,
      AuditLogEntity,
      UserEntity,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
