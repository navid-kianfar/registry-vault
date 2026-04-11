import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneralSettingsEntity } from './entities/general-settings.entity';
import { RegistryConnectionEntity } from './entities/registry-connection.entity';
import { RegistryCredentialEntity } from './entities/registry-credential.entity';
import { RetentionPolicyEntity } from './entities/retention-policy.entity';
import { WebhookEntity } from './entities/webhook.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { CredentialsController } from './credentials.controller';
import { RegistrySyncModule } from '../registry-sync/registry-sync.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneralSettingsEntity,
      RegistryConnectionEntity,
      RegistryCredentialEntity,
      RetentionPolicyEntity,
      WebhookEntity,
      DockerTagEntity,
      NpmPackageVersionEntity,
      NuGetPackageVersionEntity,
    ]),
    RegistrySyncModule,
  ],
  providers: [SettingsService],
  controllers: [SettingsController, CredentialsController],
  exports: [SettingsService],
})
export class SettingsModule {}
