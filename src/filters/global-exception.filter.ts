import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import type {
  Request,
  Response,
} from 'express';

interface ErrorResponse {
  success: false;
  statusCode: number;
  statusCodeName: string;
  message: string | string[];
  /** a machine-readable reason the client acts on, e.g. SUBSCRIPTION_REQUIRED (SubscriptionGuard) */
  code?: string;
  path: string;
  timestamp: string;
}

@Catch()
export class GlobalExceptionFilter
  implements ExceptionFilter
{
  catch(
    exception: unknown,
    host: ArgumentsHost,
  ): void {
    const context = host.switchToHttp();

    const response =
      context.getResponse<Response>();

    const request =
      context.getRequest<Request>();

    let statusCode =
      HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] =
      'Internal server error';

    let code: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();

      const exceptionResponse =
        exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseObject =
          exceptionResponse as {
            message?: string | string[];
            code?: unknown;
          };

        message =
          responseObject.message ??
          exception.message;

        if (typeof responseObject.code === 'string') {
          code = responseObject.code;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const result: ErrorResponse = {
      success: false,

      statusCode,

      statusCodeName:
        HttpStatus[statusCode] ??
        String(statusCode),

      message,

      ...(code ? { code } : {}),

      path: request.url,

      timestamp: new Date().toISOString(),
    };

    response
      .status(statusCode)
      .json(result);
  }
}