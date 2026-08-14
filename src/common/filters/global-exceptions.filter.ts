import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request, Response } from 'express';
import { ClsServiceManager } from 'nestjs-cls';

import { AppClsStore } from '@/infra/cls/module';
import { CustomHttpException } from '../exceptions/custom-http-exception';

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  constructor(private httpAdapterHost: HttpAdapterHost) {}

  catch(exception: Error, host: ArgumentsHost) {
    this.logException(exception, host);

    /**
     * NOTE: the below condition is equivalent to the following: "exception instanceof CustomHttpException"
     * For some reason, the instanceof does not work as expected when importing from another module.
     */
    if (
      exception.constructor.name ===
      CustomHttpException.prototype.constructor.name
    ) {
      return this.catchCustomHttpException(
        exception as CustomHttpException,
        host,
      );
    }
    return this.catchHttpException(exception, host);
  }

  private catchCustomHttpException(
    exception: CustomHttpException,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception.getStatus();

    response.status(status).json({
      ...(exception.getResponse() as Record<string, any>),
      error: exception.error,
      metadata: exception.metadata,
    });
  }

  private catchHttpException(exception: Error, host: ArgumentsHost) {
    // In certain situations `httpAdapter` might not be available in the
    // constructor method, thus we should resolve it here.
    const { httpAdapter } = this.httpAdapterHost;

    const ctx = host.switchToHttp();

    const statusCode = this.getStatusCode(exception);
    const responseBody =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            statusCode,
            message: exception.message || 'Internal server error',
          };

    httpAdapter.reply(ctx.getResponse(), responseBody, statusCode);
  }

  private logException(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const { method, url, body, query, params } = request;

    const statusCode = this.getStatusCode(exception);
    const isServerError = statusCode >= 500;

    const startTime =
      ClsServiceManager.getClsService<AppClsStore>().get('startTime');

    const payload = {
      method,
      path: url,
      statusCode,
      ...(startTime ? { durationMs: Date.now() - startTime } : {}),
      body,
      query,
      params,
      error: exception.message,
      ...(isServerError ? { stack: exception.stack } : {}),
    };
    const message = `Request failed ${method} ${url}`;

    if (isServerError) {
      this.logger.error(message, payload);
    } else {
      this.logger.warn(message, payload);
    }
  }

  private getStatusCode(exception: any): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if ((exception as any).code === 'ENOENT') {
      return HttpStatus.NOT_FOUND;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
