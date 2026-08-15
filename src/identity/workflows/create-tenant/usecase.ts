import { Injectable, Logger } from '@nestjs/common';

import { TenantRepository } from '@/identity/cores/repositories/tenant.repository';
import { TenantEventsPublisher } from '@/identity/infra/kafka/tenant-events.publisher';
import { BaseUseCase } from '@/shared/use-case/base-use-case';
import { CreateTenantUseCaseTypes } from './types';

@Injectable()
export class CreateTenantUseCase extends BaseUseCase<
  CreateTenantUseCaseTypes.Input,
  CreateTenantUseCaseTypes.Output
> {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly tenantEventsPublisher: TenantEventsPublisher,
  ) {
    super(new Logger(CreateTenantUseCase.name));
  }

  async handle(
    input: CreateTenantUseCaseTypes.Input,
  ): Promise<CreateTenantUseCaseTypes.Output> {
    const tenant = await this.tenantRepository.createOne({ name: input.name });

    // Announced after the tenant exists, never before: an event about something
    // that failed to be stored is worse than no event. Publishing cannot fail the
    // request — see the publisher's note on why this dual write is tolerable.
    await this.tenantEventsPublisher.tenantCreated({
      tenantId: tenant._id.toString(),
      name: tenant.name,
      createdAt: tenant.createdAt.getTime(),
    });

    return {
      id: tenant._id.toString(),
      name: tenant.name,
      createdAt: tenant.createdAt,
    };
  }
}
