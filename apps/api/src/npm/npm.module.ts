import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NpmPackageEntity } from './entities/npm-package.entity';
import { NpmPackageVersionEntity } from './entities/npm-package-version.entity';
import { NpmController } from './npm.controller';
import { NpmService } from './npm.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NpmPackageEntity, NpmPackageVersionEntity]),
  ],
  controllers: [NpmController],
  providers: [NpmService],
})
export class NpmModule {}
