import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import type {
  IRegistryCredential,
  ICreateCredentialRequest,
  IUpdateCredentialRequest,
} from '@registry-vault/shared';
import { SettingsService } from './settings.service';

@Controller('api/credentials')
export class CredentialsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getCredentials(): Promise<IRegistryCredential[]> {
    return this.settingsService.getCredentials();
  }

  @Post()
  async createCredential(
    @Body() body: ICreateCredentialRequest,
  ): Promise<IRegistryCredential> {
    return this.settingsService.createCredential(body);
  }

  @Patch(':id')
  async updateCredential(
    @Param('id') id: string,
    @Body() body: IUpdateCredentialRequest,
  ): Promise<IRegistryCredential> {
    return this.settingsService.updateCredential(id, body);
  }

  @Delete(':id')
  async deleteCredential(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteCredential(id);
  }
}
