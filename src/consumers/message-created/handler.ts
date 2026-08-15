import { Injectable, Logger } from '@nestjs/common';

import { MessageSearchIndex } from '@/infra/elasticsearch/message-search.index';
import { toSearchDocument } from './indexing';
import {
  isDeletion,
  isIndexable,
  MessageCreatedEvent,
} from './message-created.event';

/**
 * Turns a batch of change events into one bulk index request.
 *
 * Batch-shaped rather than message-shaped on purpose: per-document indexing tops
 * out around 220 messages a second and would be the pipeline's ceiling long
 * before Kafka is — see docs/back-of-envelope.md and D22.
 */
@Injectable()
export class MessageCreatedHandler {
  private readonly logger = new Logger(MessageCreatedHandler.name);

  constructor(private readonly searchIndex: MessageSearchIndex) {}

  async handleBatch(events: MessageCreatedEvent[]): Promise<void> {
    // Deletions are filtered before anything else. The connector publishes them
    // to the same topic, and a deleted message has nothing left to index.
    const inserts = events.filter((event) => !isDeletion(event));
    const indexable = inserts.filter((event) => isIndexable(event));

    if (indexable.length < inserts.length) {
      // Dropped rather than thrown: a record the connector shaped differently —
      // an older transform chain, a hand-published message — would otherwise fail
      // the batch forever and wedge every message behind it on that partition.
      this.logger.warn('Skipping records that are missing identity fields', {
        skipped: inserts.length - indexable.length,
        ids: inserts.filter((e) => !isIndexable(e)).map((e) => e._id ?? null),
      });
    }

    if (indexable.length === 0) {
      return;
    }

    await this.searchIndex.indexMany(indexable.map(toSearchDocument));

    this.logger.debug('Indexed a batch of messages', {
      received: events.length,
      indexed: indexable.length,
    });
  }
}
