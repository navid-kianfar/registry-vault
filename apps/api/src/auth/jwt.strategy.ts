import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { Role } from '@registry-vault/shared/enums';

import { UserEntity } from '../rbac/entities/user.entity';

interface JwtPayload {
  sub: string;
  username: string;
  role: number;
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Resolve the caller from the database, not from the token.
   *
   * The token is valid for 24 hours and carries the role it was minted with, so
   * trusting it meant a demotion, a deactivation or a deletion took up to a day
   * to bite — the holder kept administrator rights for the rest of the token's
   * life. One lookup by primary key per request is cheap enough to be worth
   * that not being true.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('This account no longer exists');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('This account is deactivated');
    }

    return {
      userId: user.id,
      username: user.username,
      role: user.role,
    };
  }
}
