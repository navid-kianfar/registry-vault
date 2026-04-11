import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Request } from '@nestjs/common';
import type { IUser, ICreateUserRequest, IUpdateUserRequest, IChangePasswordRequest, PaginatedResponse } from '@registry-vault/shared';
import { UsersService } from './users.service';

interface JwtRequest {
  user: { userId: string; username: string; role: number };
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
  async createUser(@Body() body: ICreateUserRequest): Promise<IUser> {
    return this.usersService.createUser(body);
  }

  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: IUpdateUserRequest,
  ): Promise<IUser> {
    return this.usersService.updateUser(id, body);
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string): Promise<void> {
    return this.usersService.deleteUser(id);
  }

  @Patch(':id/password')
  async changePassword(
    @Param('id') id: string,
    @Body() body: IChangePasswordRequest,
    @Request() req: JwtRequest,
  ): Promise<void> {
    // If changing own password, require currentPassword verification
    // If admin changes another user's password, skip current password check
    const isSelf = req.user.userId === id;
    return this.usersService.changePassword(id, {
      ...body,
      currentPassword: isSelf ? body.currentPassword : undefined,
    });
  }
}
