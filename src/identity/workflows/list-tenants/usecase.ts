import { Injectable, Logger } from '@nestjs/common';

import { TenantRepository } from '@/identity/cores/repositories/tenant.repository';
import { BaseUseCase } from '@/shared/use-case/base-use-case';
import { ListTenantsUseCaseTypes } from './types';

/**
 * Every tenant, so the demo UI can offer one to pick before it can ask for users.
 *
 * This is the only listing in the system that is not scoped to a tenant, and it is
 * the one place where that is not a mistake: a tenant *is* the scope, and something
 * has to enumerate them before anybody has chosen one. It is safe here only because
 * `ForDemoOnlyGuard` refuses the route outside a local environment — a real product
 * would answer this from an admin context with its own authorisation, and would
 * never expose the list of organisations to a tenant's own users.
 *
 * Unpaginated for the same reason as `ListUsersUseCase`: it fills a dropdown in a
 * demonstration, and the repository caps what it returns.
 */
@Injectable()
export class ListTenantsUseCase extends BaseUseCase<
  ListTenantsUseCaseTypes.Input,
  ListTenantsUseCaseTypes.Output
> {
  constructor(private readonly tenantRepository: TenantRepository) {
    super(new Logger(ListTenantsUseCase.name));
  }

  async handle(): Promise<ListTenantsUseCaseTypes.Output> {
    const tenants = await this.tenantRepository.listAll();

    return {
      items: tenants.map((tenant) => ({
        id: tenant._id.toString(),
        name: tenant.name,
        createdAt: tenant.createdAt,
      })),
    };
  }
}
