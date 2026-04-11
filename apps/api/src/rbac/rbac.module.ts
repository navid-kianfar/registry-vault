import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { TeamEntity } from './entities/team.entity';
import { UsersService } from './users.service';
import { TeamsService } from './teams.service';
import { UsersController } from './users.controller';
import { TeamsController } from './teams.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, TeamEntity])],
  providers: [UsersService, TeamsService],
  controllers: [UsersController, TeamsController],
  exports: [UsersService, TeamsService],
})
export class RbacModule {}
