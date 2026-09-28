import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentClientModule } from './agent-client.module';
import { AgentController } from './agent.controller';
import { AgentEventsService } from './agent-events.service';
import { AgentGcScheduler } from './agent-gc.scheduler';
import { AgentPullStatsService } from './agent-pull-stats.service';
import { AgentRelayService } from './agent-relay.service';
import { AgentScanService } from './agent-scan.service';
import { DockerAgentController } from './docker-agent.controller';
import { EmbeddedRegistryService } from './embedded-registry.service';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RegistrySyncModule } from '../registry-sync/registry-sync.module';

import { DockerImageDetailEntity } from '../docker/entities/docker-image-detail.entity';
import { DockerPullStatEntity } from '../docker/entities/docker-pull-stat.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerScanResultEntity } from '../docker/entities/docker-scan-result.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';

/**
 * Everything that talks to a registry agent: the relay the browser calls, the
 * event poller behind pull counts, scans, scheduled garbage collection, and the
 * all-in-one image's self-registration.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RegistryConnectionEntity,
      RegistryCredentialEntity,
      DockerRepositoryEntity,
      DockerTagEntity,
      DockerImageDetailEntity,
      DockerPullStatEntity,
      DockerScanResultEntity,
    ]),
    AgentClientModule,
    AuditLogsModule,
    RegistrySyncModule,
  ],
  providers: [
    AgentRelayService,
    AgentEventsService,
    AgentScanService,
    AgentPullStatsService,
    AgentGcScheduler,
    EmbeddedRegistryService,
  ],
  controllers: [AgentController, DockerAgentController],
  exports: [AgentScanService],
})
export class AgentModule {}
