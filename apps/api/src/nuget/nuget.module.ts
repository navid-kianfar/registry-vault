import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NuGetPackageEntity } from './entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from './entities/nuget-package-version.entity';
import { NuGetController } from './nuget.controller';
import { NuGetService } from './nuget.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NuGetPackageEntity, NuGetPackageVersionEntity]),
  ],
  controllers: [NuGetController],
  providers: [NuGetService],
})
export class NuGetModule {}
