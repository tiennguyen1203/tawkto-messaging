import { Injectable, Logger } from '@nestjs/common';

import {
  MessageIndexWrite,
  MessageSearchIndex,
} from '@/messaging/infra/elasticsearch/message-search.index';
import { toSearchDocument } from './indexing';
import {
  isDeletion,
  isIndexable,
  MessageChangeEvent,
} from './message-changed.event';

/**
 * Turns a batch of change events into one bulk request.
 *
 * The mapping is one write per event, in the order the events arrived — a create
 * and an update both become an `index`, a deletion becomes a `delete`. Collapsing
 * a batch to one write per message id would be smaller, but it would also require
 * every event to carry a full post-image forever, and it would throw away the
 * per-event stream that anything else wanting to react to a change will need.
 *
 * Batch-shaped rather than message-shaped on purpose: per-document indexing tops
 * out around 220 messages a second and would be the pipeline's ceiling long
 * before Kafka is — see docs/back-of-envelope.md and D22.
 */
@Injectable()
export class MessageChangeHandler {
  private readonly logger = new Logger(MessageChangeHandler.name);

  constructor(private readonly messageSearchIndex: MessageSearchIndex) {}

  async handleBatch(events: MessageChangeEvent[]): Promise<void> {
    const usable = events.filter((event) => isIndexable(event));

    if (usable.length < events.length) {
      // Dropped rather than thrown: a record the connector shaped differently —
      // an older transform chain, a hand-published message — would otherwise fail
      // the batch forever and wedge every message behind it on that partition.
      this.logger.warn('Skipping records that are missing identity fields', {
        skipped: events.length - usable.length,
        ids: events.filter((e) => !isIndexable(e)).map((e) => e._id ?? null),
      });
    }

    if (usable.length === 0) {
      return;
    }

    const writes: MessageIndexWrite[] = usable.map((event) =>
      isDeletion(event)
        ? { op: 'delete', tenantId: event.tenantId, messageId: event._id }
        : { op: 'index', document: toSearchDocument(event) },
    );

    await this.messageSearchIndex.applyWrites(writes);

    this.logger.debug('Applied a batch of message changes', {
      received: events.length,
      indexed: writes.filter((write) => write.op === 'index').length,
      deleted: writes.filter((write) => write.op === 'delete').length,
    });
  }
}
