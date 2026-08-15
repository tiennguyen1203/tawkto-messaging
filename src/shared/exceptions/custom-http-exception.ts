import { HttpException } from '@nestjs/common';

export class CustomHttpException extends HttpException {
  constructor(
    message: string,
    statusCode: number,
    public error: string,
    public metadata?: Record<string, any>,
  ) {
    super({ message, statusCode }, statusCode);
  }
}
