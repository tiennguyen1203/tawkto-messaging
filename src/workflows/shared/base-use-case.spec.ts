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
    it('returns data with a null error on success', async () => {
      await expect(usecase.execute({})).resolves.toEqual({
        data: { ok: true },
        error: null,
      });
    });

    it('maps a typed domain error onto the result, preserving metadata', async () => {
      const { data, error } = await usecase.execute({ shouldFail: 'notFound' });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
      expect(error?.message).toBe('conversation not found');
      expect(error?.metadata).toEqual({ id: '42' });
    });

    it('does not leak an unexpected error to the caller', async () => {
      const { error } = await usecase.execute({ shouldFail: 'unknown' });

      expect(error?.type).toBe(UseCaseErrorType.INTERNAL_SERVER_ERROR);
      expect(error?.message).not.toContain('did not anticipate');
    });
  });

  describe('#executeOrThrowHttpError', () => {
    it('returns the payload directly on success', async () => {
      await expect(usecase.executeOrThrowHttpError({})).resolves.toEqual({
        ok: true,
      });
    });

    it('turns NOT_FOUND into a 404', async () => {
      await expect(
        usecase.executeOrThrowHttpError({ shouldFail: 'notFound' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('turns a business rule violation into a 422', async () => {
      await expect(
        usecase.executeOrThrowHttpError({ shouldFail: 'businessRule' }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('#throwIfHaveErrorInUseCase', () => {
    it('is a no-op when there is no error', () => {
      expect(() => throwIfHaveErrorInUseCase(null)).not.toThrow();
    });
  });
});
