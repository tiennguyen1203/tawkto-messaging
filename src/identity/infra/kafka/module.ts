import { Global, Module } from '@nestjs/common';

import { TenantEventsPublisher } from './tenant-events.publisher';

/**
 * Global, unlike this service's workflows and repositories.
 *
 * The distinction is what the module *is*, not where it sits: a publisher is
 * infrastructure, in the same category as the cache and the database connection,
 * and infrastructure being ambient is ordinary. Domain modules being ambient is
 * what let `commonModules` carry one service's repositories into another's, which
 * is why those are still imported explicitly.
 */
@Global()
@Module({
  providers: [TenantEventsPublisher],
  exports: [TenantEventsPublisher],
})
export class IdentityKafkaModule {}
