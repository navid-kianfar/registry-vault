import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';
import { RegistrySyncModule } from '../registry-sync/registry-sync.module';
import { BulkService } from './bulk.service';
import { BulkController } from './bulk.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DockerRepositoryEntity,
      DockerTagEntity,
      NpmPackageEntity,
      NpmPackageVersionEntity,
      NuGetPackageEntity,
      NuGetPackageVersionEntity,
      RegistryConnectionEntity,
      RegistryCredentialEntity,
    ]),
    RegistrySyncModule,
  ],
  providers: [BulkService],
  controllers: [BulkController],
  exports: [BulkService],
})
export class BulkModule {}
