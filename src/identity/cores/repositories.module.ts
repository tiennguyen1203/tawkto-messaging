import { Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { TenantRepository } from './repositories/tenant.repository';
import { UserRepository } from './repositories/user.repository';

/** Same connection-alias reasoning as messaging's repositories module (D3). */
const connectionAlias = {
  provide: Connection,
  useExisting: getConnectionToken(),
};

const repositories = [TenantRepository, UserRepository];

@Module({
  providers: [connectionAlias, ...repositories],
  exports: [...repositories],
})
export class IdentityRepositoriesModule {}
