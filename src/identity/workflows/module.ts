import { Module } from '@nestjs/common';

import { IdentityRepositoriesModule } from '@/identity/cores/repositories.module';
import { CreateTenantUseCase } from './create-tenant/usecase';
import { CreateUserUseCase } from './create-user/usecase';
import { IssueTokenUseCase } from './issue-token/usecase';
import { ListTenantsUseCase } from './list-tenants/usecase';
import { ListUsersUseCase } from './list-users/usecase';

const useCases = [
  CreateTenantUseCase,
  ListTenantsUseCase,
  CreateUserUseCase,
  ListUsersUseCase,
  IssueTokenUseCase,
];

@Module({
  imports: [IdentityRepositoriesModule],
  providers: [...useCases],
  exports: [...useCases],
})
export class IdentityWorkflowsModule {}
