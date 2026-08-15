import { Injectable, Logger } from '@nestjs/common';

import { UserRepository } from '@/identity/cores/repositories/user.repository';
import { AuthUtils } from '@/shared/utils/auth.util';
import {
  BaseUseCase,
  NotFoundUseCaseError,
} from '@/shared/use-case/base-use-case';
import { IssueTokenUseCaseTypes } from './types';

const TOKEN_LIFETIME = '1d';

/**
 * Signs a token for a user, having checked nothing about who is asking.
 *
 * That is the whole of the shortcut, and it is why this lives under
 * `for-demo`: authentication normally starts with proving you are the user,
 * and here you merely name one. Everything downstream of the token is real — the
 * signature, the tenant it carries, the scoping every repository does with it —
 * so what is missing is exactly one step, in exactly one place.
 */
@Injectable()
export class IssueTokenUseCase extends BaseUseCase<
  IssueTokenUseCaseTypes.Input,
  IssueTokenUseCaseTypes.Output
> {
  constructor(private readonly userRepository: UserRepository) {
    super(new Logger(IssueTokenUseCase.name));
  }

  async handle(
    input: IssueTokenUseCaseTypes.Input,
  ): Promise<IssueTokenUseCaseTypes.Output> {
    const user = await this.userRepository.findById(input.userId);

    if (!user) {
      throw new NotFoundUseCaseError('User not found.');
    }

    const accessToken = AuthUtils.generateJwt(
      {
        id: user._id.toString(),
        tenantId: user.tenantId,
        roles: user.roles,
      },
      TOKEN_LIFETIME,
    );

    return {
      accessToken,
      expiresIn: TOKEN_LIFETIME,
      user: {
        id: user._id.toString(),
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
    };
  }
}
