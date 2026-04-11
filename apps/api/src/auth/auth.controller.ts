import { Body, Controller, Get, Post, Request } from '@nestjs/common';
import type { ILoginRequest, ILoginResponse, IAuthUser } from '@registry-vault/shared';
import { AuthService } from './auth.service';

interface JwtRequest {
  user: { userId: string; username: string; role: number };
}
import { Public } from '../common/decorators/public.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() loginRequest: ILoginRequest): Promise<ILoginResponse> {
    return this.authService.login(loginRequest);
  }

  @Post('logout')
  async logout(): Promise<void> {
    // Acknowledge logout - token invalidation is handled client-side
    return;
  }

  @Get('me')
  async getCurrentUser(@Request() req: JwtRequest): Promise<IAuthUser> {
    return this.authService.getCurrentUser(req.user.userId);
  }
}
