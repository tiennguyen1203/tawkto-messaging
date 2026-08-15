import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { JwtStrategy } from '@/shared/auth-passport/jwt.strategy';
import { JwtStrategyGuard } from '@/shared/guards';
import { platformModules } from '@/shared/platform';
import { IdentityRepositoriesModule } from './cores/repositories.module';
import { IdentityKafkaModule } from './infra/kafka/module';
import { IdentityRoutersModule } from './routers/module';
import { IdentityWorkflowsModule } from './workflows/module';

/**
 * What every Identity process needs before it is any particular one: the shared
 * platform, plus this service's own infrastructure.
 */
export const identityModules = [...platformModules, IdentityKafkaModule];

/**
 * Identity's composition root — its own process, its own port.
 *
 * The guard is registered even though every route this service currently exposes
 * is public: a route added later would otherwise be open by default, which is the
 * wrong direction for a mistake to fall.
 */
@Module({
  imports: [
    ...identityModules,
    IdentityRepositoriesModule,
    IdentityWorkflowsModule,
    IdentityRoutersModule,
  ],
  providers: [
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtStrategyGuard,
    },
  ],
})
export class IdentityAppModule {}
