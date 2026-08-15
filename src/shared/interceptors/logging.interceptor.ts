import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { AppClsStore } from '@/shared/infra/cls/module';

const SKIP_PATH_PREFIXES = ['/api/health'];

const shouldSkip = (url: string): boolean =>
  SKIP_PATH_PREFIXES.some((p) => url.startsWith(p));

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, body, params, query } = request;

    if (shouldSkip(url)) {
      return next.handle();
    }

    // tenantId / userId are already in CLS — JwtStrategy puts them there the
    // moment the token is verified, which is before this interceptor runs.
    const startTime = this.cls.get('startTime') ?? Date.now();

    return next.handle().pipe(
      // NOTE: only successful requests are logged here. Failures (incl. those
      // rejected by guards before this interceptor runs) are logged centrally
      // in GlobalExceptionsFilter to avoid duplicate logs.
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        this.logger.log(`Request completed ${method} ${url}`, {
          method,
          path: url,
          statusCode: response.statusCode,
          durationMs: Date.now() - startTime,
          body,
          query,
          params,
        });
      }),
    );
  }
}
