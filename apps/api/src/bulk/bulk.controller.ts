import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
  Request,
} from '@nestjs/common';
import { Role } from '@registry-vault/shared/enums';
import type {
  IBulkDeleteRequest,
  IBulkDeleteResult,
  ICleanupVersionsRequest,
  IRegistryRepairRequest,
  IRegistryRepairResult,
} from '@registry-vault/shared';
import { BulkService } from './bulk.service';
import { Roles } from '../common/decorators/roles.decorator';

interface JwtRequest {
  user: { userId: string; username: string; role: Role };
}

/** How many offending items to name before the message stops being useful. */
const MAX_REPORTED_ITEMS = 5;

/**
 * Every route here deletes from a real registry. Administrators may do all of
 * it; maintainers may delete individual tags and versions, but not whole
 * repositories or packages, and not the registry-wide operations.
 */
@Controller('api/bulk')
@Roles(Role.Admin)
export class BulkController {
  constructor(private readonly bulkService: BulkService) {}

  @Post('delete')
  @Roles(Role.Admin, Role.Maintainer)
  async bulkDelete(
    @Body() body: IBulkDeleteRequest,
    @Request() request: JwtRequest,
  ): Promise<IBulkDeleteResult> {
    this.requireDeletableItems(body, request.user.role);
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

  /**
   * Check the whole request before anything is deleted.
   *
   * An item without a `versionIdentifier` deletes the entire repository or
   * package, which is administrator work. The check covers every item up front
   * precisely so a mixed request cannot delete the tags and then refuse the
   * repository, leaving the caller half-way through an operation they were
   * never allowed to start.
   */
  private requireDeletableItems(request: IBulkDeleteRequest, role: Role): void {
    const items = request?.items;

    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('"items" must list at least one thing to delete');
    }

    if (role === Role.Admin) return;

    const wholePackages = items
      .filter((item) => !item.versionIdentifier)
      .map((item) => item.packageIdentifier);

    if (wholePackages.length === 0) return;

    const named = wholePackages.slice(0, MAX_REPORTED_ITEMS).join(', ');
    const rest = wholePackages.length - MAX_REPORTED_ITEMS;

    throw new ForbiddenException(
      `Deleting a whole repository or package requires an administrator — ${wholePackages.length} item(s) name no version: ${named}${rest > 0 ? ` and ${rest} more` : ''}. Nothing was deleted.`,
    );
  }
}
