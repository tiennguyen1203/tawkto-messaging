import { Injectable, Logger } from '@nestjs/common';

import { TenantRepository } from '@/identity/cores/repositories/tenant.repository';
import { UserRepository } from '@/identity/cores/repositories/user.repository';
import {
  BaseUseCase,
  ConflictUseCaseError,
  NotFoundUseCaseError,
} from '@/shared/use-case/base-use-case';
import { CreateUserUseCaseTypes } from './types';

@Injectable()
export class CreateUserUseCase extends BaseUseCase<
  CreateUserUseCaseTypes.Input,
  CreateUserUseCaseTypes.Output
> {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly userRepository: UserRepository,
  ) {
    super(new Logger(CreateUserUseCase.name));
  }

  async handle(
    input: CreateUserUseCaseTypes.Input,
  ): Promise<CreateUserUseCaseTypes.Output> {
    // A user without a tenant is a user nothing can scope, and the token it would
    // be issued would carry a tenant that does not exist — which messaging would
    // accept, because it only checks the signature.
    const tenant = await this.tenantRepository.findById(input.tenantId);

    if (!tenant) {
      throw new NotFoundUseCaseError('Tenant not found.');
    }

    const existing = await this.userRepository.findByEmailInTenant(
      input.tenantId,
      input.email,
    );

    if (existing) {
      throw new ConflictUseCaseError(
        'A user with that email already exists in this tenant.',
      );
    }

    const user = await this.userRepository.createOne({
      tenantId: input.tenantId,
      email: input.email,
      displayName: input.displayName,
      roles: input.roles,
    });

    return {
      id: user._id.toString(),
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
    };
  }
}
