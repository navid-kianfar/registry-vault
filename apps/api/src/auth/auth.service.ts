import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import type { IAuthUser, ILoginRequest, ILoginResponse } from '@registry-vault/shared';
import { AuditAction } from '@registry-vault/shared/enums';
import { UserEntity } from '../rbac/entities/user.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async validateUser(username: string, password: string): Promise<UserEntity | null> {
    const user = await this.userRepository.findOne({
      where: { username },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(loginRequest: ILoginRequest): Promise<ILoginResponse> {
    const user = await this.validateUser(loginRequest.username, loginRequest.password);

    if (!user) {
      // Log failed login attempt
      await this.auditLogsService.log({
        action: AuditAction.LoginFailure,
        actorId: 'anonymous',
        actorUsername: loginRequest.username,
        resourceType: 'auth',
        resourceName: loginRequest.username,
        success: false,
      }).catch(() => {});
      throw new UnauthorizedException('Invalid username or password');
    }

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const token = this.jwtService.sign(payload);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Log successful login
    await this.auditLogsService.log({
      action: AuditAction.LoginSuccess,
      actorId: user.id,
      actorUsername: user.username,
      resourceType: 'auth',
      resourceName: user.username,
      success: true,
    }).catch(() => {});

    return {
      user: this.mapUserToAuthUser(user),
      token,
      expiresAt,
    };
  }

  async getCurrentUser(userId: string): Promise<IAuthUser> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.mapUserToAuthUser(user);
  }

  private mapUserToAuthUser(user: UserEntity): IAuthUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }
}
