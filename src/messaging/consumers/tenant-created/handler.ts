import { Injectable, Logger } from '@nestjs/common';

import { MessageSearchIndex } from '@/messaging/infra/elasticsearch/message-search.index';
import { isProvisionable, TenantCreatedEvent } from './tenant-created.event';

/**
 * Creates a tenant's search alias when the tenant appears.
 *
 * This is what moves alias creation off the write path: by the time the tenant's
 * first message arrives, the alias is already there. `MessageSearchIndex` still
 * creates one lazily if it is not, which is what makes a lost event survivable
 * rather than fatal — see the publisher on the Identity side.
 *
 * Idempotent because `ensureAlias` is: a redelivered event is a no-op.
 */
@Injectable()
export class TenantCreatedHandler {
  private readonly logger = new Logger(TenantCreatedHandler.name);

  constructor(private readonly messageSearchIndex: MessageSearchIndex) {}

  async handleBatch(events: TenantCreatedEvent[]): Promise<void> {
    const usable = events.filter((event) => isProvisionable(event));

    if (usable.length < events.length) {
      this.logger.warn('Skipping tenant events with no tenantId', {
        skipped: events.length - usable.length,
      });
    }

    for (const event of usable) {
      await this.messageSearchIndex.ensureAlias(event.tenantId);
    }

    if (usable.length > 0) {
      this.logger.log('Provisioned search aliases', {
        tenants: usable.map((event) => event.tenantId),
      });
    }
  }
}
