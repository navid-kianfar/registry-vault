import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { Role } from '@registry-vault/shared/enums';
import type {
  IRegistryCredential,
  ICreateCredentialRequest,
  IUpdateCredentialRequest,
} from '@registry-vault/shared';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Credentials never return their secret, so listing them stays open to any
 * authenticated user; creating, changing or deleting one is administrator work.
 */
@Controller('api/credentials')
export class CredentialsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getCredentials(): Promise<IRegistryCredential[]> {
    return this.settingsService.getCredentials();
  }

  @Post()
  @Roles(Role.Admin)
  async createCredential(
    @Body() body: ICreateCredentialRequest,
  ): Promise<IRegistryCredential> {
    return this.settingsService.createCredential(body);
  }

  @Patch(':id')
  @Roles(Role.Admin)
  async updateCredential(
    @Param('id') id: string,
    @Body() body: IUpdateCredentialRequest,
  ): Promise<IRegistryCredential> {
    return this.settingsService.updateCredential(id, body);
  }

  @Delete(':id')
  @Roles(Role.Admin)
  async deleteCredential(@Param('id') id: string): Promise<void> {
    return this.settingsService.deleteCredential(id);
  }
}
