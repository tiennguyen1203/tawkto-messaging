import { Logger } from '@nestjs/common';
import {
  BaseUseCase,
  BusinessRuleUseCaseError,
  NotFoundUseCaseError,
  UseCaseErrorType,
  throwIfHaveErrorInUseCase,
} from './base-use-case';

type Input = { shouldFail?: 'notFound' | 'businessRule' | 'unknown' };
type Output = { ok: true };

class SampleUseCase extends BaseUseCase<Input, Output> {
  constructor() {
    super(new Logger(SampleUseCase.name));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async handle(input: Input): Promise<Output> {
    if (input.shouldFail === 'notFound') {
      throw new NotFoundUseCaseError('conversation not found', { id: '42' });
    }
    if (input.shouldFail === 'businessRule') {
      throw new BusinessRuleUseCaseError('sender is not a participant');
    }
    if (input.shouldFail === 'unknown') {
      throw new TypeError('something the use case did not anticipate');
    }
    return { ok: true };
  }
}

describe('@workflows/shared/base-use-case', () => {
  let usecase: SampleUseCase;

  beforeAll(() => {
    Logger.overrideLogger(false);
    usecase = new SampleUseCase();
  });

  describe('#execute', () => {
    describe('when the use case succeeds', () => {
      it('should return the data with a null error', async () => {
        await expect(usecase.execute({})).resolves.toEqual({
          data: { ok: true },
          error: null,
        });
      });
    });

    describe('when the use case throws a typed domain error', () => {
      it('should map it onto the result, preserving the metadata', async () => {
        const { data, error } = await usecase.execute({
          shouldFail: 'notFound',
        });

        expect(data).toBeNull();
        expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
        expect(error?.message).toBe('conversation not found');
        expect(error?.metadata).toEqual({ id: '42' });
      });
    });

    describe('when the use case throws something unanticipated', () => {
      it('should not leak the internal message to the caller', async () => {
        const { error } = await usecase.execute({ shouldFail: 'unknown' });

        expect(error?.type).toBe(UseCaseErrorType.INTERNAL_SERVER_ERROR);
        expect(error?.message).not.toContain('did not anticipate');
      });
    });
  });

  describe('#executeOrThrowHttpError', () => {
    describe('when the use case succeeds', () => {
      it('should return the payload directly', async () => {
        await expect(usecase.executeOrThrowHttpError({})).resolves.toEqual({
          ok: true,
        });
      });
    });

    describe('when the use case reports NOT_FOUND', () => {
      it('should throw a 404', async () => {
        await expect(
          usecase.executeOrThrowHttpError({ shouldFail: 'notFound' }),
        ).rejects.toMatchObject({ status: 404 });
      });
    });

    describe('when the use case reports a business rule violation', () => {
      it('should throw a 422', async () => {
        await expect(
          usecase.executeOrThrowHttpError({ shouldFail: 'businessRule' }),
        ).rejects.toMatchObject({ status: 422 });
      });
    });
  });

  describe('#throwIfHaveErrorInUseCase', () => {
    describe('when there is no error', () => {
      it('should do nothing', () => {
        expect(() => throwIfHaveErrorInUseCase(null)).not.toThrow();
      });
    });
  });
});
