import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerRepositoryEntity } from './entities/docker-repository.entity';
import { DockerTagEntity } from './entities/docker-tag.entity';
import { DockerImageDetailEntity } from './entities/docker-image-detail.entity';
import { DockerController } from './docker.controller';
import { DockerService } from './docker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DockerRepositoryEntity,
      DockerTagEntity,
      DockerImageDetailEntity,
    ]),
  ],
  controllers: [DockerController],
  providers: [DockerService],
  exports: [DockerService],
})
export class DockerModule {}
