import { Injectable, Logger } from '@nestjs/common';

import { TenantRepository } from '@/identity/cores/repositories/tenant.repository';
import { BaseUseCase } from '@/shared/use-case/base-use-case';
import { CreateTenantUseCaseTypes } from './types';

@Injectable()
export class CreateTenantUseCase extends BaseUseCase<
  CreateTenantUseCaseTypes.Input,
  CreateTenantUseCaseTypes.Output
> {
  constructor(private readonly tenantRepository: TenantRepository) {
    super(new Logger(CreateTenantUseCase.name));
  }

  async handle(
    input: CreateTenantUseCaseTypes.Input,
  ): Promise<CreateTenantUseCaseTypes.Output> {
    const tenant = await this.tenantRepository.createOne({ name: input.name });

    return {
      id: tenant._id.toString(),
      name: tenant.name,
      createdAt: tenant.createdAt,
    };
  }
}
