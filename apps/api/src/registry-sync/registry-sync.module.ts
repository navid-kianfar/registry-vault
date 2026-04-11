import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DockerRegistryConnector } from './connectors/docker-registry.connector';
import { NpmRegistryConnector } from './connectors/npm-registry.connector';
import { NuGetRegistryConnector } from './connectors/nuget-registry.connector';
import { RegistrySyncService } from './registry-sync.service';

import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { DockerImageDetailEntity } from '../docker/entities/docker-image-detail.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { AuditLogEntity } from '../audit-logs/entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RegistryConnectionEntity,
      RegistryCredentialEntity,
      DockerRepositoryEntity,
      DockerTagEntity,
      DockerImageDetailEntity,
      NpmPackageEntity,
      NpmPackageVersionEntity,
      NuGetPackageEntity,
      NuGetPackageVersionEntity,
      AuditLogEntity,
    ]),
  ],
  providers: [
    DockerRegistryConnector,
    NpmRegistryConnector,
    NuGetRegistryConnector,
    RegistrySyncService,
  ],
  exports: [RegistrySyncService, DockerRegistryConnector, NpmRegistryConnector, NuGetRegistryConnector],
})
export class RegistrySyncModule {}
