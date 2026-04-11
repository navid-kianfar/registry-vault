import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';

export interface PaginatedResponse<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export async function paginate<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  page: number,
  pageSize: number,
): Promise<PaginatedResponse<T>> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(100, pageSize));

  const skip = (safePage - 1) * safePageSize;

  const [items, totalCount] = await queryBuilder
    .skip(skip)
    .take(safePageSize)
    .getManyAndCount();

  const totalPages = Math.ceil(totalCount / safePageSize);

  return {
    items,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
  };
}

export interface SortOrder {
  [key: string]: 'ASC' | 'DESC';
}

const ALLOWED_SORT_DIRECTIONS = ['ASC', 'DESC', 'asc', 'desc'];

export function buildSortOrder(
  sortBy?: string,
  sortOrder?: string,
  allowedFields?: string[],
): SortOrder {
  if (!sortBy) {
    return { createdAt: 'DESC' };
  }

  if (allowedFields && !allowedFields.includes(sortBy)) {
    return { createdAt: 'DESC' };
  }

  const direction =
    sortOrder && ALLOWED_SORT_DIRECTIONS.includes(sortOrder)
      ? (sortOrder.toUpperCase() as 'ASC' | 'DESC')
      : 'DESC';

  return { [sortBy]: direction };
}
