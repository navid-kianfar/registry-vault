import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role, RegistryType, WebhookEvent } from '@registry-vault/shared/enums';

import { UserEntity } from '../rbac/entities/user.entity';
import { TeamEntity } from '../rbac/entities/team.entity';
import { GeneralSettingsEntity } from '../settings/entities/general-settings.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RetentionPolicyEntity } from '../settings/entities/retention-policy.entity';
import { WebhookEntity } from '../settings/entities/webhook.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(TeamEntity)
    private readonly teamRepo: Repository<TeamEntity>,
    @InjectRepository(GeneralSettingsEntity)
    private readonly settingsRepo: Repository<GeneralSettingsEntity>,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(RetentionPolicyEntity)
    private readonly retentionRepo: Repository<RetentionPolicyEntity>,
    @InjectRepository(WebhookEntity)
    private readonly webhookRepo: Repository<WebhookEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<void> {
    // Only seed if database is empty
    const userCount = await this.userRepo.count();
    if (userCount > 0) {
      this.logger.log('Database already seeded, skipping');
      return;
    }

    this.logger.log('Seeding database with initial data...');

    // 1. Create default teams
    const platformTeam = await this.teamRepo.save(
      this.teamRepo.create({
        name: 'Platform Engineering',
        description: 'Platform infrastructure and DevOps team',
        memberCount: 0,
      }),
    );

    const backendTeam = await this.teamRepo.save(
      this.teamRepo.create({
        name: 'Backend',
        description: 'Backend development team',
        memberCount: 0,
      }),
    );

    const frontendTeam = await this.teamRepo.save(
      this.teamRepo.create({
        name: 'Frontend',
        description: 'Frontend development team',
        memberCount: 0,
      }),
    );

    // 2. Create default admin user
    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    const adminUser = await this.userRepo.save(
      this.userRepo.create({
        username: 'admin',
        email: 'admin@registryvault.local',
        displayName: 'System Admin',
        avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=SA',
        role: Role.Admin,
        isActive: true,
        passwordHash: adminPasswordHash,
        lastLoginAt: new Date().toISOString(),
        teams: [platformTeam],
      }),
    );

    // 3. Create sample users
    const johnPasswordHash = await bcrypt.hash('password123', 10);
    const johnUser = await this.userRepo.save(
      this.userRepo.create({
        username: 'john.doe',
        email: 'john.doe@registryvault.local',
        displayName: 'John Doe',
        avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=JD',
        role: Role.Maintainer,
        isActive: true,
        passwordHash: johnPasswordHash,
        lastLoginAt: new Date().toISOString(),
        teams: [backendTeam],
      }),
    );

    const viewerPasswordHash = await bcrypt.hash('viewer123', 10);
    const viewerUser = await this.userRepo.save(
      this.userRepo.create({
        username: 'viewer',
        email: 'viewer@registryvault.local',
        displayName: 'Viewer User',
        avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=VU',
        role: Role.Reader,
        isActive: true,
        passwordHash: viewerPasswordHash,
        lastLoginAt: new Date().toISOString(),
        teams: [frontendTeam],
      }),
    );

    // Update team member counts
    platformTeam.memberCount = 1;
    backendTeam.memberCount = 1;
    frontendTeam.memberCount = 1;
    await this.teamRepo.save([platformTeam, backendTeam, frontendTeam]);

    // 4. Create general settings
    await this.settingsRepo.save(
      this.settingsRepo.create({
        instanceName: 'Registry Vault',
        instanceUrl: 'http://localhost:3001',
        allowSelfRegistration: false,
        defaultRole: Role.Reader,
        sessionTimeoutMinutes: 480,
        maintenanceMode: false,
      }),
    );

    // 5. Create sample registry connections
    await this.connectionRepo.save([
      this.connectionRepo.create({
        registryType: RegistryType.Docker,
        name: 'Docker Hub',
        url: 'https://registry-1.docker.io',
        isDefault: true,
        isConnected: false,
        username: 'docker-user',
      }),
      this.connectionRepo.create({
        registryType: RegistryType.NPM,
        name: 'Local NPM',
        url: 'http://localhost:4873',
        isDefault: true,
        isConnected: false,
        username: 'npm-user',
      }),
      this.connectionRepo.create({
        registryType: RegistryType.NuGet,
        name: 'Local NuGet',
        url: 'http://localhost:5001',
        isDefault: true,
        isConnected: false,
        username: 'nuget-user',
      }),
    ]);

    // 6. Create sample retention policies
    await this.retentionRepo.save([
      this.retentionRepo.create({
        registryType: RegistryType.Docker,
        name: 'Docker Image Cleanup',
        enabled: true,
        keepLastN: 10,
        olderThanDays: 90,
        tagPatternExclude: '^(latest|v\\d+\\.\\d+\\.\\d+)$',
      }),
      this.retentionRepo.create({
        registryType: RegistryType.NuGet,
        name: 'NuGet Package Retention',
        enabled: true,
        keepLastN: 5,
        olderThanDays: 180,
        tagPatternExclude: '^\\d+\\.\\d+\\.\\d+$',
      }),
      this.retentionRepo.create({
        registryType: RegistryType.NPM,
        name: 'NPM Package Cleanup',
        enabled: false,
        keepLastN: 20,
        olderThanDays: 365,
      }),
    ]);

    // 7. Create sample webhooks
    await this.webhookRepo.save([
      this.webhookRepo.create({
        name: 'Slack Notifications',
        url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXX',
        events: [WebhookEvent.Push, WebhookEvent.Delete, WebhookEvent.SecurityScan],
        isActive: true,
        secret: 'webhook-secret-slack',
        lastTriggeredAt: new Date().toISOString(),
        lastStatusCode: 200,
      }),
      this.webhookRepo.create({
        name: 'CI/CD Pipeline Trigger',
        url: 'https://ci.example.com/api/webhooks/registry',
        events: [WebhookEvent.Push],
        registryType: RegistryType.Docker,
        isActive: true,
        secret: 'webhook-secret-cicd',
        lastTriggeredAt: new Date().toISOString(),
        lastStatusCode: 200,
      }),
    ]);

    this.logger.log('Database seeded successfully');
  }
}
