import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { platformModules } from '@/shared/platform';
import { JwtStrategyGuard } from '@/shared/guards';
import { JwtStrategy } from '@/shared/auth-passport/jwt.strategy';
import { RoutersModule } from './routers/module';
import { RepositoriesModule } from './cores/repositories.module';
import { WorkflowsModule } from './workflows/module';

/**
 * What both of this service's processes load — the HTTP API and the indexer
 * alike. The platform modules come from the shared kernel; everything below them
 * is messaging's own.
 */
export const messagingModules = [
  ...platformModules,
  RepositoriesModule,
  WorkflowsModule,
];

@Module({
  imports: [...messagingModules, RoutersModule],
  providers: [
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtStrategyGuard,
    },
  ],
})
export class AppModule {}
