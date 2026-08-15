import { Module } from '@nestjs/common';

import { HealthCheckModule } from '@/shared/health-check/health-check.module';
import { IdentityWorkflowsModule } from '@/identity/workflows/module';
import { ForDemoController } from './for-demo/controller';

/**
 * Imports its dependencies explicitly rather than relying on `@Global()`. A
 * global module is invisible at the point of use, and invisible edges are how
 * `commonModules` came to carry one service's repositories into another's.
 *
 * The line is drawn at what a module *is*: infrastructure may be ambient — the
 * cache, the connection, `IdentityKafkaModule` — because every part of a service
 * uses it and none of it carries domain meaning. Workflows and repositories may
 * not, because those are the pieces that must not leak across a boundary.
 */
@Module({
  // Liveness belongs to every process, not to one service — which is why the
  // module sits in the shared kernel.
  imports: [HealthCheckModule, IdentityWorkflowsModule],
  controllers: [ForDemoController],
})
export class IdentityRoutersModule {}
