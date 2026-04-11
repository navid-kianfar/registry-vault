import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

import { UserEntity } from '../rbac/entities/user.entity';
import { TeamEntity } from '../rbac/entities/team.entity';
import { GeneralSettingsEntity } from '../settings/entities/general-settings.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RetentionPolicyEntity } from '../settings/entities/retention-policy.entity';
import { WebhookEntity } from '../settings/entities/webhook.entity';

import { SeedService } from './seed.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get<string>('DB_TYPE', 'sqlite');

        if (dbType === 'postgres') {
          return {
            type: 'postgres' as const,
            host: configService.get<string>('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 5432),
            username: configService.get<string>('DB_USERNAME', 'postgres'),
            password: configService.get<string>('DB_PASSWORD', 'postgres'),
            database: configService.get<string>(
              'DB_NAME',
              'registryvault',
            ),
            autoLoadEntities: true,
            synchronize: true,
          };
        }

        const dbPath = configService.get<string>(
          'DB_PATH',
          './data/registry-vault.db',
        );

        return {
          type: 'better-sqlite3' as const,
          database: path.resolve(dbPath),
          autoLoadEntities: true,
          synchronize: true,
        };
      },
    }),
    TypeOrmModule.forFeature([
      UserEntity,
      TeamEntity,
      GeneralSettingsEntity,
      RegistryConnectionEntity,
      RetentionPolicyEntity,
      WebhookEntity,
    ]),
  ],
  providers: [SeedService],
  exports: [SeedService],
})
export class DatabaseModule {}
