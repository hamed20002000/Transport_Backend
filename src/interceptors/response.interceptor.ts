import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from 'src/presentation/helpers/api-response';
import { getHttpStatusName } from 'src/presentation/helpers/http-status-code';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest();
    const path = request.url; // گرفتن مسیر درخواست

    // اگر مسیر درخواست برابر با "/api/auth/apple/callback" بود، مستقیماً داده را بدون تغییر بازگردان
    if (path === '/api/auth/apple/callback') {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        const statusCode = response.statusCode || HttpStatus.OK;
        const statusCodeName = getHttpStatusName(response.statusCode || HttpStatus.OK);
        return new ApiResponse<T>(
          true,
          statusCode,
          statusCodeName,
          'Request processed successfully',
          data,
          Array.isArray(data) ? data.length : undefined,
        );
      }),
    );
  }
}
