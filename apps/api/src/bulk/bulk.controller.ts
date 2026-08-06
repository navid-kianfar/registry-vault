import { Controller, Post, Body } from '@nestjs/common';
import type {
  IBulkDeleteRequest,
  IBulkDeleteResult,
  ICleanupVersionsRequest,
  IRegistryRepairRequest,
  IRegistryRepairResult,
} from '@registry-vault/shared';
import { BulkService } from './bulk.service';

@Controller('api/bulk')
export class BulkController {
  constructor(private readonly bulkService: BulkService) {}

  @Post('delete')
  async bulkDelete(
    @Body() body: IBulkDeleteRequest,
  ): Promise<IBulkDeleteResult> {
    return this.bulkService.bulkDelete(body);
  }

  @Post('cleanup')
  async cleanupVersions(
    @Body() body: ICleanupVersionsRequest,
  ): Promise<IBulkDeleteResult> {
    return this.bulkService.cleanupVersions(body);
  }

  /**
   * Scan a Docker registry for tags left dangling by a partial delete and, with
   * `apply: true`, finish removing them. Defaults to a dry run.
   */
  @Post('repair')
  async repairRegistry(
    @Body() body: IRegistryRepairRequest,
  ): Promise<IRegistryRepairResult> {
    return this.bulkService.repairDockerRegistry(body);
  }
}
