import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import type { IUser, ICreateUserRequest, IUpdateUserRequest, IChangePasswordRequest, PaginatedResponse } from '@registry-vault/shared';
import { Role } from '@registry-vault/shared/enums';
import { UsersService } from './users.service';
import { AnyRole, Roles } from '../common/decorators/roles.decorator';

interface JwtRequest {
  user: { userId: string; username: string; role: Role };
}

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getUsers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('query') query?: string,
  ): Promise<PaginatedResponse<IUser>> {
    return this.usersService.getUsers({
      page: parseInt(page as string) || 1,
      pageSize: parseInt(pageSize as string) || 20,
      sortBy: sortBy || 'createdAt',
      sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
      query: query || undefined,
    });
  }

  @Get(':id')
  async getUser(@Param('id') id: string): Promise<IUser> {
    return this.usersService.getUser(id);
  }

  @Post()
  @Roles(Role.Admin)
  async createUser(@Body() body: ICreateUserRequest): Promise<IUser> {
    return this.usersService.createUser(body);
  }

  @Patch(':id')
  @Roles(Role.Admin)
  async updateUser(
    @Param('id') id: string,
    @Body() body: IUpdateUserRequest,
  ): Promise<IUser> {
    return this.usersService.updateUser(id, body);
  }

  @Delete(':id')
  @Roles(Role.Admin)
  async deleteUser(@Param('id') id: string): Promise<void> {
    return this.usersService.deleteUser(id);
  }

  /**
   * Change a password. Anyone may change their own, proving they know the
   * current one; only an administrator may reset someone else's, and then the
   * current password is not required because they do not know it.
   *
   * Without the ownership check here, "any authenticated user" would have meant
   * any reader could reset the administrator's password.
   */
  @Patch(':id/password')
  @AnyRole()
  async changePassword(
    @Param('id') id: string,
    @Body() body: IChangePasswordRequest,
    @Request() req: JwtRequest,
  ): Promise<void> {
    const isSelf = req.user.userId === id;

    if (isSelf) {
      return this.usersService.changeOwnPassword(
        id,
        body.currentPassword ?? '',
        body.newPassword,
      );
    }

    if (req.user.role !== Role.Admin) {
      throw new ForbiddenException("Only an administrator can change another user's password");
    }

    return this.usersService.resetPassword(id, body.newPassword);
  }
}
