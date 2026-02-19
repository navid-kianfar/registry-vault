export type PaginatedResponse<T> = {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type PaginationParams = {
  page: number;
  pageSize: number;
};

export type SortParams = {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
};
