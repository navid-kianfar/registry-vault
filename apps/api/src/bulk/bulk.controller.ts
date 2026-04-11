import { Controller, Post, Body } from '@nestjs/common';
import type {
  IBulkDeleteRequest,
  IBulkDeleteResult,
  ICleanupVersionsRequest,
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
}
