import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { AgentClientService } from './agent-client.service';

/**
 * The agent client on its own, with no dependency on bulk operations or the
 * registry sync — so the modules that do (bulk, settings, docker) can talk to
 * an agent without a circular import.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RegistryConnectionEntity])],
  providers: [AgentClientService],
  exports: [AgentClientService],
})
export class AgentClientModule {}
