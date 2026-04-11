import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode } from '@nestjs/common';
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
} from '@registry-vault/shared';
import { SettingsService } from './settings.service';
import { RegistrySyncService } from '../registry-sync/registry-sync.service';

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
  async createRegistryConnection(
    @Body() body: ICreateRegistryConnectionRequest,
  ): Promise<IRegistryConnection> {
    return this.settingsService.createRegistryConnection(body);
  }

  @Patch('registries/:id')
  async updateRegistryConnection(
    @Param('id') id: string,
    @Body() body: IUpdateRegistryConnectionRequest,
  ): Promise<IRegistryConnection> {
    return this.settingsService.updateRegistryConnection(id, body);
  }

  @Delete('registries/:id')
  async deleteRegistryConnection(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteRegistryConnection(id);
  }

  @Post('registries/:id/sync')
  @HttpCode(200)
  async syncRegistryConnection(@Param('id') id: string): Promise<{ synced: boolean }> {
    await this.registrySyncService.syncConnectionById(id);
    return { synced: true };
  }

  @Post('sync')
  @HttpCode(200)
  async syncAllRegistries(): Promise<{ synced: boolean }> {
    await this.registrySyncService.syncAll();
    return { synced: true };
  }

  @Get('retention')
  async getRetentionPolicies(): Promise<IRetentionPolicy[]> {
    return this.settingsService.getRetentionPolicies();
  }

  @Post('retention')
  async createRetentionPolicy(
    @Body() body: ICreateRetentionPolicyRequest,
  ): Promise<IRetentionPolicy> {
    return this.settingsService.createRetentionPolicy(body);
  }

  @Patch('retention/:id')
  async updateRetentionPolicy(
    @Param('id') id: string,
    @Body() body: IUpdateRetentionPolicyRequest,
  ): Promise<IRetentionPolicy> {
    return this.settingsService.updateRetentionPolicy(id, body);
  }

  @Delete('retention/:id')
  async deleteRetentionPolicy(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteRetentionPolicy(id);
  }

  @Post('retention/:id/run')
  async runRetentionPolicy(@Param('id') id: string): Promise<{ deleted: number }> {
    return this.settingsService.runRetentionPolicy(id);
  }

  @Get('webhooks')
  async getWebhooks(): Promise<IWebhook[]> {
    return this.settingsService.getWebhooks();
  }

  @Post('webhooks')
  async createWebhook(@Body() body: ICreateWebhookRequest): Promise<IWebhook> {
    return this.settingsService.createWebhook(body);
  }

  @Patch('webhooks/:id')
  async updateWebhook(
    @Param('id') id: string,
    @Body() body: IUpdateWebhookRequest,
  ): Promise<IWebhook> {
    return this.settingsService.updateWebhook(id, body);
  }

  @Delete('webhooks/:id')
  async deleteWebhook(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteWebhook(id);
  }
}
