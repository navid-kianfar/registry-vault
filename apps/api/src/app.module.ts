import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { join } from 'path';

import { CryptoModule } from './common/crypto/crypto.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { DockerModule } from './docker/docker.module';
import { NpmModule } from './npm/npm.module';
import { NuGetModule } from './nuget/nuget.module';
import { RbacModule } from './rbac/rbac.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SettingsModule } from './settings/settings.module';
import { BulkModule } from './bulk/bulk.module';
import { RegistrySyncModule } from './registry-sync/registry-sync.module';
import { DashboardModule } from './dashboard/dashboard.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';

// SeedService is provided by DatabaseModule and runs via OnModuleInit

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Local development reads apps/api/.env. In production (the Docker image
      // sets NODE_ENV=production) configuration comes exclusively from the
      // process environment supplied at `docker run` — never from a file on
      // disk, so no env file can be baked into an image layer.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: join(__dirname, '..', '.env'),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'web', 'dist'),
      exclude: ['/api*'],
    }),
    ScheduleModule.forRoot(),
    CryptoModule,
    DatabaseModule,
    AuthModule,
    DockerModule,
    NpmModule,
    NuGetModule,
    RbacModule,
    AuditLogsModule,
    AnalyticsModule,
    SettingsModule,
    BulkModule,
    RegistrySyncModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    },
  ],
})
export class AppModule {}
