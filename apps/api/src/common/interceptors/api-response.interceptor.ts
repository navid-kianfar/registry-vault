import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

export interface ApiResponseShape<T> {
  data?: T;
  success: boolean;
  error?: string;
  statusCode?: number;
  timestamp: string;
}

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseShape<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseShape<T>> {
    return next.handle().pipe(
      map((data) => ({
        data,
        success: true,
        timestamp: new Date().toISOString(),
      })),
      catchError((error) => {
        const statusCode =
          error instanceof HttpException
            ? error.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

        const message =
          error instanceof HttpException
            ? (error.getResponse() as { message?: string })?.message ?? error.message
            : 'Internal server error';

        const errorMessage = Array.isArray(message)
          ? message.join(', ')
          : message;

        return throwError(
          () =>
            new HttpException(
              {
                success: false,
                error: errorMessage,
                statusCode,
                timestamp: new Date().toISOString(),
              },
              statusCode,
            ),
        );
      }),
    );
  }
}
