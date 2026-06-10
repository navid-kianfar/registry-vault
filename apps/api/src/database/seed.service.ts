import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '@registry-vault/shared/enums';

import { UserEntity } from '../rbac/entities/user.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * On first start (empty users table) create the initial admin account from
   * ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL. Once any user exists the
   * seed is skipped, so these variables only matter for the very first boot.
   */
  async seed(): Promise<void> {
    const userCount = await this.userRepo.count();
    if (userCount > 0) {
      return;
    }

    const username = this.configService.get<string>('ADMIN_USERNAME', 'admin');
    const password = this.configService.get<string>('ADMIN_PASSWORD');
    const email = this.configService.get<string>(
      'ADMIN_EMAIL',
      'admin@registryvault.local',
    );

    if (!password) {
      throw new Error(
        'ADMIN_PASSWORD is required on first start with an empty database. ' +
          'Set it (e.g. docker run -e ADMIN_PASSWORD=...) to create the initial admin account.',
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepo.save(
      this.userRepo.create({
        username,
        email,
        displayName: username,
        avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`,
        role: Role.Admin,
        isActive: true,
        passwordHash,
      }),
    );

    this.logger.log(`Created initial admin user "${username}"`);
  }
}
