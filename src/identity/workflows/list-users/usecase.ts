import { Injectable, Logger } from '@nestjs/common';

import { UserRepository } from '@/identity/cores/repositories/user.repository';
import { BaseUseCase } from '@/shared/use-case/base-use-case';
import { ListUsersUseCaseTypes } from './types';

/**
 * Everyone in a tenant, for the identity switcher in the demo UI.
 *
 * Unpaginated on purpose: this exists to fill a dropdown in a local
 * demonstration, and the repository caps what it returns. A real directory would
 * need a cursor, and would look like the messaging listing.
 */
@Injectable()
export class ListUsersUseCase extends BaseUseCase<
  ListUsersUseCaseTypes.Input,
  ListUsersUseCaseTypes.Output
> {
  constructor(private readonly userRepository: UserRepository) {
    super(new Logger(ListUsersUseCase.name));
  }

  async handle(
    input: ListUsersUseCaseTypes.Input,
  ): Promise<ListUsersUseCaseTypes.Output> {
    const users = await this.userRepository.listByTenant(input.tenantId);

    return {
      items: users.map((user) => ({
        id: user._id.toString(),
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      })),
    };
  }
}
