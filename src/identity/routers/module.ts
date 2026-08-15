import { Module } from '@nestjs/common';

import { HealthCheckModule } from '@/shared/health-check/health-check.module';
import { IdentityWorkflowsModule } from '@/identity/workflows/module';
import { ForDemoController } from './for-demo/controller';

/**
 * Imports its dependencies explicitly rather than relying on `@Global()`. A
 * global module is invisible at the point of use, and invisible edges are how
 * `commonModules` came to carry one service's repositories into another's.
 */
@Module({
  // Liveness belongs to every process, not to one service — which is why the
  // module sits in the shared kernel.
  imports: [HealthCheckModule, IdentityWorkflowsModule],
  controllers: [ForDemoController],
})
export class IdentityRoutersModule {}
