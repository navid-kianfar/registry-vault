import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode } from '@nestjs/common';
import { Role } from '@registry-vault/shared/enums';
import type {
  IGeneralSettings,
  IRegistryConnection,
  ICreateRegistryConnectionRequest,
  IUpdateRegistryConnectionRequest,
  IRetentionPolicy,
  ICreateRetentionPolicyRequest,
  IUpdateRetentionPolicyRequest,
  IWebhook,
  ICreateWebhookRequest,
  IUpdateWebhookRequest,
  IRegistrySyncResult,
  IRetentionRunResult,
  IAgentTestRequest,
  IAgentInfo,
} from '@registry-vault/shared';
import { SettingsService } from './settings.service';
import { RegistrySyncService } from '../registry-sync/registry-sync.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('api/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly registrySyncService: RegistrySyncService,
  ) {}

  @Get('general')
  async getGeneralSettings(): Promise<IGeneralSettings> {
    return this.settingsService.getGeneralSettings();
  }

  @Patch('general')
  @Roles(Role.Admin)
  async updateGeneralSettings(
    @Body() body: Partial<IGeneralSettings>,
  ): Promise<IGeneralSettings> {
    return this.settingsService.updateGeneralSettings(body);
  }

  @Get('registries')
  async getRegistryConnections(): Promise<IRegistryConnection[]> {
    return this.settingsService.getRegistryConnections();
  }

  @Post('registries')
  @Roles(Role.Admin)
  async createRegistryConnection(
    @Body() body: ICreateRegistryConnectionRequest,
  ): Promise<IRegistryConnection> {
    return this.settingsService.createRegistryConnection(body);
  }

  @Patch('registries/:id')
  @Roles(Role.Admin)
  async updateRegistryConnection(
    @Param('id') id: string,
    @Body() body: IUpdateRegistryConnectionRequest,
  ): Promise<IRegistryConnection> {
    return this.settingsService.updateRegistryConnection(id, body);
  }

  @Delete('registries/:id')
  @Roles(Role.Admin)
  async deleteRegistryConnection(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteRegistryConnection(id);
  }

  /** Probe an agent before its connection exists; both url and apiKey are required. */
  @Post('registries/agent/test')
  @HttpCode(200)
  @Roles(Role.Admin)
  async testUnsavedRegistryAgent(@Body() body: IAgentTestRequest): Promise<IAgentInfo> {
    return this.settingsService.testUnsavedRegistryAgent(body ?? {});
  }

  /** Probe the agent of a saved connection, with its stored key unless one is given. */
  @Post('registries/:id/agent/test')
  @HttpCode(200)
  @Roles(Role.Admin)
  async testRegistryAgent(
    @Param('id') id: string,
    @Body() body: IAgentTestRequest,
  ): Promise<IAgentInfo> {
    return this.settingsService.testRegistryAgent(id, body ?? {});
  }

  @Post('registries/:id/sync')
  @HttpCode(200)
  @Roles(Role.Admin)
  async syncRegistryConnection(@Param('id') id: string): Promise<IRegistrySyncResult> {
    return this.registrySyncService.syncConnectionById(id);
  }

  @Post('sync')
  @HttpCode(200)
  @Roles(Role.Admin)
  async syncAllRegistries(): Promise<IRegistrySyncResult> {
    return this.registrySyncService.syncAll();
  }

  @Get('retention')
  async getRetentionPolicies(): Promise<IRetentionPolicy[]> {
    return this.settingsService.getRetentionPolicies();
  }

  @Post('retention')
  @Roles(Role.Admin)
  async createRetentionPolicy(
    @Body() body: ICreateRetentionPolicyRequest,
  ): Promise<IRetentionPolicy> {
    return this.settingsService.createRetentionPolicy(body);
  }

  @Patch('retention/:id')
  @Roles(Role.Admin)
  async updateRetentionPolicy(
    @Param('id') id: string,
    @Body() body: IUpdateRetentionPolicyRequest,
  ): Promise<IRetentionPolicy> {
    return this.settingsService.updateRetentionPolicy(id, body);
  }

  @Delete('retention/:id')
  @Roles(Role.Admin)
  async deleteRetentionPolicy(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteRetentionPolicy(id);
  }

  @Post('retention/:id/run')
  @Roles(Role.Admin)
  async runRetentionPolicy(@Param('id') id: string): Promise<IRetentionRunResult> {
    return this.settingsService.runRetentionPolicy(id);
  }

  /** Admin-only: a webhook's signing secret is part of this payload. */
  @Get('webhooks')
  @Roles(Role.Admin)
  async getWebhooks(): Promise<IWebhook[]> {
    return this.settingsService.getWebhooks();
  }

  @Post('webhooks')
  @Roles(Role.Admin)
  async createWebhook(@Body() body: ICreateWebhookRequest): Promise<IWebhook> {
    return this.settingsService.createWebhook(body);
  }

  @Patch('webhooks/:id')
  @Roles(Role.Admin)
  async updateWebhook(
    @Param('id') id: string,
    @Body() body: IUpdateWebhookRequest,
  ): Promise<IWebhook> {
    return this.settingsService.updateWebhook(id, body);
  }

  @Delete('webhooks/:id')
  @Roles(Role.Admin)
  async deleteWebhook(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteWebhook(id);
  }
}
