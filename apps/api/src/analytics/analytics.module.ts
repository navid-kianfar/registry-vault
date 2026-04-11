import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from '../audit-logs/entities/audit-log.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      DockerRepositoryEntity,
      NpmPackageEntity,
      NuGetPackageEntity,
    ]),
  ],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
