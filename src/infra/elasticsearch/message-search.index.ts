import { Client } from '@elastic/elasticsearch';
import { Injectable } from '@nestjs/common';

import { MESSAGES_INDEX, messageAliasFor } from '@/common/constants';

/**
 * A document as the search index maps it.
 *
 * Owned here rather than by whatever produces it: the index declares the shape,
 * and `dynamic: strict` means a field the mapping does not know rejects the
 * whole bulk request. That is deliberate — an unnoticed change to what is stored
 * announces itself at the write instead of silently landing unindexed data.
 */
export type MessageSearchDocument = {
  messageId: string;
  tenantId: string;
  conversationId: string;
  senderId: string;
  content: string;
  /** Epoch milliseconds, matching the index's `epoch_millis` date format. */
  timestamp: number;
  metadata?: Record<string, unknown>;
};

/**
 * The only way into the message search index.
 *
 * Nothing outside this class names the concrete index: callers hand it documents
 * and it resolves the tenant's alias itself. That is what keeps the shared-index
 * layout (ADR-003) a private detail — splitting it into an index per tenant later
 * changes this file and nothing else.
 */
@Injectable()
export class MessageSearchIndex {
  /**
   * Aliases already known to exist in this process. Creating one is idempotent
   * but costs a round trip, and a busy consumer would otherwise pay it on every
   * batch.
   */
  private readonly ensured = new Set<string>();

  constructor(private readonly client: Client) {}

  /**
   * Creates the tenant's filtered alias if this process has not seen it before.
   *
   * The filter and the routing live on the alias rather than in the query, so
   * Elasticsearch enforces the tenant boundary itself — the same reason queries
   * are scoped by the repository rather than by their callers.
   */
  async ensureAlias(tenantId: string): Promise<string> {
    const alias = messageAliasFor(tenantId);

    if (this.ensured.has(alias)) {
      return alias;
    }

    const exists = await this.client.indices.existsAlias({ name: alias });

    if (!exists) {
      await this.client.indices.putAlias({
        index: MESSAGES_INDEX,
        name: alias,
        filter: { term: { tenantId } },
        index_routing: tenantId,
        search_routing: tenantId,
      });
    }

    this.ensured.add(alias);
    return alias;
  }

  /**
   * Indexes a batch in one request, grouped so each tenant's documents go
   * through its own alias.
   *
   * The document id is the message id, which makes a redelivery an overwrite
   * rather than a duplicate — the property that lets the pipeline stay
   * at-least-once without the consumer tracking what it has already seen.
   *
   * No `refresh` is requested. Forcing one per batch creates a segment per batch,
   * which is the churn Elasticsearch warns about and would undo the throughput
   * bulk indexing exists to buy (D22). The index refreshes every second on its
   * own, and nothing is waiting on a message becoming searchable that instant.
   */
  async indexMany(documents: MessageSearchDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    // A document without these two is not a data condition to tolerate, it is a
    // broken invariant. An absent `messageId` makes Elasticsearch generate an id,
    // which quietly turns every redelivery into a new document — the idempotence
    // the whole at-least-once pipeline rests on, gone with nothing to notice it.
    // An absent `tenantId` routes the write to `messages-undefined`. Callers keep
    // unusable records away from here; this is the backstop that says so out loud.
    const broken = documents.find((d) => !d.messageId || !d.tenantId);
    if (broken) {
      throw new Error(
        `Refusing to index a document without a messageId and tenantId: ${JSON.stringify(broken)}`,
      );
    }

    const tenants = [...new Set(documents.map((d) => d.tenantId))];
    const aliases = new Map<string, string>();
    for (const tenantId of tenants) {
      aliases.set(tenantId, await this.ensureAlias(tenantId));
    }

    const operations = documents.flatMap((document) => [
      {
        index: {
          _index: aliases.get(document.tenantId),
          _id: document.messageId,
        },
      },
      document,
    ]);

    const response = await this.client.bulk({ operations });

    if (response.errors) {
      // Surfacing the first failure rather than the whole response: a strict
      // mapping rejection repeats the same reason for every document.
      const failed = response.items.find((item) => item.index?.error);
      throw new Error(
        `Indexing failed: ${JSON.stringify(failed?.index?.error)}`,
      );
    }
  }
}
