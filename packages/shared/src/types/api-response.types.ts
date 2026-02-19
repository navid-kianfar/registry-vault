export type ApiResponse<T> = {
  data: T;
  success: boolean;
  message?: string;
  timestamp: string;
};

export type ApiErrorResponse = {
  success: false;
  error: string;
  statusCode: number;
  timestamp: string;
};
