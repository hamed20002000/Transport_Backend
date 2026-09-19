import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

import type {
  Request,
  Response,
} from 'express';

import {
  map,
  Observable,
} from 'rxjs';

export interface ApiResponseResult<T> {
  success: boolean;
  statusCode: number;
  statusCodeName: string;
  message: string;
  data: T;
  count?: number;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, T | ApiResponseResult<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<T | ApiResponseResult<T>> {
    const httpContext = context.switchToHttp();

    const request =
      httpContext.getRequest<Request>();

    const response =
      httpContext.getResponse<Response>();

    /*
     * این callback نباید wrap شود.
     */
    if (
      request.path ===
      '/api/auth/apple/callback'
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: T) => {
        const statusCode =
          response.statusCode ??
          HttpStatus.OK;

        return {
          success: true,
          statusCode,
          statusCodeName:
            HttpStatus[statusCode] ??
            String(statusCode),
          message:
            'Request processed successfully',
          data,
          count: Array.isArray(data)
            ? data.length
            : undefined,
        };
      }),
    );
  }
}