import { AuthUserType } from '@/common/types/auth-user.type';
import { AuthUtils } from '@/common/utils/auth.util';
import { BaseUseCase } from '@/workflows/shared/base-use-case';
import { expect, jest } from '@jest/globals';
import superagent from 'superagent';
import request from 'supertest';

declare module 'supertest' {
  interface Test extends superagent.SuperAgentRequest {
    requestedBy(user: AuthUserType | null): this;
    executedWithUsecase({
      usecase,
      expectedInput,
      mockOutput,
      method,
    }: {
      usecase: new (...args: any[]) => BaseUseCase<any, any>;
      expectedInput: any;
      mockOutput: any;
      method?: 'execute' | 'executeOrThrowHttpError';
    }): this;
  }
}

// HACK: This need to be fixed typing (now using any for bypassing)
(request as any).Test.prototype.requestedBy = function (
  user: AuthUserType | null,
) {
  if (user) {
    const token = AuthUtils.generateJwt(user);

    this.set({
      Authorization: `Bearer ${token}`,
    });
  }
  return this;
};

(request as any).Test.prototype.executedWithUsecase = function ({
  usecase,
  method = 'execute',
  expectedInput,
  mockOutput,
}: {
  usecase: new (...args: any[]) => BaseUseCase<any, any>;
  method: 'execute' | 'executeOrThrowHttpError';
  expectedInput: any;
  mockOutput: any;
}) {
  const useCaseSpy = jest.spyOn(usecase.prototype, method);

  let useCaseInputToBe: any;
  useCaseSpy.mockImplementation((usecaseInput: any) => {
    useCaseInputToBe = usecaseInput;
    return mockOutput;
  });

  return this.expect(function () {
    expect(useCaseSpy).toHaveBeenCalledTimes(1);
    expect(useCaseInputToBe).toEqual(expectedInput);
  });
};

export default request;
