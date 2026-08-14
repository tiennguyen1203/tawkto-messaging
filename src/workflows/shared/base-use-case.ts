import { CustomHttpException } from '@/common/exceptions/custom-http-exception';
import {
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

export type UseCaseResult<
  T,
  ErrorMetadata extends Record<string, any> = Record<string, any>,
> =
  | {
      data: T;
      error: UseCaseError<ErrorMetadata> | null;
    }
  | {
      data: null;
      error: UseCaseError<ErrorMetadata>;
    };

export type SuccessUseCaseResult<T> = T;

export abstract class BaseUseCase<
  Input,
  Output,
  ErrorMetadata extends Record<string, any> = Record<string, any>,
> {
  constructor(protected logger: Logger) {}

  async execute(input: Input): Promise<UseCaseResult<Output, ErrorMetadata>> {
    try {
      const preRunningData = await this.preRunningUseCase(input);
      const data = await this.handle(input, preRunningData);
      return {
        data,
        error: null,
      };
    } catch (error: any) {
      return this.#generateErrorOutput(error);
    }
  }

  async executeOrThrowHttpError(
    input: Input,
  ): Promise<SuccessUseCaseResult<Output>> {
    const { error, data } = await this.execute(input);
    throwIfHaveErrorInUseCase(error);

    return data as Output;
  }

  async executeOrThrowUseCaseError(input: Input): Promise<Output> {
    try {
      const preRunningData = await this.preRunningUseCase(input);
      const data = await this.handle(input, preRunningData);
      return data;
    } catch (error: any) {
      switch (true) {
        case error.name in UseCaseErrorType:
          throw error;

        default:
          this.logger.error('Unknown error occurred', error);
          throw new UnknownUseCaseError(
            error.message ||
              'An unexpected error occurred. Please try again later.',
          );
      }
    }
  }

  protected abstract handle(
    _input: Input,
    preRunningData?: any,
  ): Promise<Output>;

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async preRunningUseCase(input: Input): Promise<any> {
    this.logger.debug('Pre running use case with', { input });
  }

  #generateErrorOutput(error: Error): UseCaseResult<Output, ErrorMetadata> {
    switch (true) {
      case error.name in UseCaseErrorType:
        return {
          data: null,
          error: new UseCaseError<ErrorMetadata>(
            error.message,
            error.name as UseCaseErrorType,
          ).withMetadata((error as WithMetadataError<ErrorMetadata>).metadata),
        };
      default:
        this.logger.error('Unknown error occurred:');
        this.logger.error(error);
        return {
          data: null,
          error: new UseCaseError(
            'An unexpected error occurred. Please try again later.',
            UseCaseErrorType.INTERNAL_SERVER_ERROR,
          ),
        };
    }
  }
}

export enum UseCaseErrorType {
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BUSINESS_RULE = 'BUSINESS_RULE',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UNAUTHORIZED = 'UNAUTHORIZED',
}

class WithMetadataError<
  ErrorMetadata extends Record<string, any>,
> extends Error {
  constructor(
    message?: string,
    public metadata?: ErrorMetadata,
  ) {
    super(message);
    this.name = UseCaseErrorType.INVALID_INPUT;
  }
}

export class InvalidInputUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(
    message?: string,
    public metadata?: ErrorMetadata,
  ) {
    super(message, metadata);
    this.name = UseCaseErrorType.INVALID_INPUT;
  }
}

export class NotFoundUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(message?: string, metadata?: ErrorMetadata) {
    super(message, metadata);
    this.name = UseCaseErrorType.NOT_FOUND;
  }
}

export class ConflictUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(message?: string, metadata?: ErrorMetadata) {
    super(message, metadata);
    this.name = UseCaseErrorType.CONFLICT;
  }
}

export class BusinessRuleUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(
    message?: string,
    public metadata?: ErrorMetadata,
  ) {
    super(message, metadata);
    this.name = UseCaseErrorType.BUSINESS_RULE;
  }
}

export class PermissionDeniedUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(
    message?: string,
    public metadata?: ErrorMetadata,
  ) {
    super(message, metadata);
    this.name = UseCaseErrorType.PERMISSION_DENIED;
  }
}

export class UnauthorizedUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(
    message?: string,
    public metadata?: ErrorMetadata,
  ) {
    super(message, metadata);
    this.name = UseCaseErrorType.UNAUTHORIZED;
  }
}

export class UnknownUseCaseError<
  ErrorMetadata extends Record<string, any>,
> extends WithMetadataError<ErrorMetadata> {
  constructor(
    message?: string,
    public metadata?: ErrorMetadata,
  ) {
    super(message, metadata);
    this.name = UseCaseErrorType.INTERNAL_SERVER_ERROR;
  }
}

export class UseCaseError<
  ErrorMetadata extends Record<string, any> = Record<string, any>,
> {
  public metadata?: ErrorMetadata;
  constructor(
    public message: string,
    public type: UseCaseErrorType,
    public code?: string,
  ) {
    this.code = code || 'UNKNOWN';
  }

  withMetadata(metadata?: ErrorMetadata) {
    this.metadata = metadata;
    return this;
  }
}

export const throwIfHaveErrorInUseCase = (error: UseCaseError | null) => {
  if (!error) {
    return;
  }

  const errorTypeStatusCodeMap = {
    [UseCaseErrorType.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
    [UseCaseErrorType.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [UseCaseErrorType.CONFLICT]: HttpStatus.CONFLICT,
    [UseCaseErrorType.BUSINESS_RULE]: HttpStatus.UNPROCESSABLE_ENTITY,
    [UseCaseErrorType.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
    [UseCaseErrorType.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
    [UseCaseErrorType.INTERNAL_SERVER_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  };

  const errorTypeErrorMap = {
    [UseCaseErrorType.INVALID_INPUT]: 'Bad Request',
    [UseCaseErrorType.NOT_FOUND]: 'Not Found',
    [UseCaseErrorType.CONFLICT]: 'Conflict',
    [UseCaseErrorType.BUSINESS_RULE]: 'Unprocessable Entity',
    [UseCaseErrorType.PERMISSION_DENIED]: 'Forbidden',
    [UseCaseErrorType.UNAUTHORIZED]: 'Unauthorized',
    [UseCaseErrorType.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  };

  switch (error.type) {
    case UseCaseErrorType.INVALID_INPUT:
    case UseCaseErrorType.NOT_FOUND:
    case UseCaseErrorType.CONFLICT:
    case UseCaseErrorType.BUSINESS_RULE:
    case UseCaseErrorType.PERMISSION_DENIED:
    case UseCaseErrorType.UNAUTHORIZED:
      throw new CustomHttpException(
        error.message,
        errorTypeStatusCodeMap[error.type] || HttpStatus.BAD_REQUEST,
        errorTypeErrorMap[error.type] || 'Unknown Error',
        error.metadata || {},
      );
    case UseCaseErrorType.INTERNAL_SERVER_ERROR:
      throw new InternalServerErrorException(error.message);
    default:
      throw new Error(error.message || 'Unknown error');
  }
};
