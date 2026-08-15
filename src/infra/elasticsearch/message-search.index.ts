import { Client, estypes } from '@elastic/elasticsearch';
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
 * One change to the index, in the order it happened upstream.
 *
 * There is no separate `create` — a create and an update both write the document
 * whole, because the change events carry a full post-image and because `index` is
 * the only action that is safe to replay. Elasticsearch's `create` rejects an id
 * that already exists (409), which would turn every redelivery into a failed
 * batch and a retry loop; `update` merges rather than replaces and 404s when the
 * document is absent. `index` states the intent that actually matters here: make
 * the document equal this.
 */
export type MessageIndexWrite =
  | { op: 'index'; document: MessageSearchDocument }
  | { op: 'delete'; tenantId: string; messageId: string };

const identityOf = (write: MessageIndexWrite) =>
  write.op === 'index'
    ? { tenantId: write.document.tenantId, messageId: write.document.messageId }
    : { tenantId: write.tenantId, messageId: write.messageId };

/**
 * The only way into the message search index.
 *
 * Nothing outside this class names the concrete index: callers hand it writes and
 * it resolves each tenant's alias itself. That is what keeps the shared-index
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
   * Applies a batch of changes in one request, **in the order given**.
   *
   * The order is the contract. Elasticsearch executes bulk actions in sequence
   * per document id, so a create, an edit and a deletion of one message inside a
   * single batch land as written and the document ends up gone. Reorder these
   * operations — group them by tenant, split them into chunks and fire the chunks
   * concurrently — and a stale document silently overwrites a fresh one, or a
   * deleted message comes back. Nothing here will report it. If this ever needs
   * to be parallel, give each write an external version first.
   *
   * Every write goes through the tenant's alias, deletes included. The alias
   * carries `index_routing`, so a document written through it lives on the shard
   * that routing chose; a delete addressed to the concrete index instead computes
   * the shard from the id, looks in the wrong one, and answers `not_found` while
   * the document stays exactly where it was.
   *
   * No `refresh` is requested. Forcing one per batch creates a segment per batch,
   * which is the churn Elasticsearch warns about and would undo the throughput
   * bulk indexing exists to buy (D22). The index refreshes every second on its
   * own, and nothing is waiting on a message becoming searchable that instant.
   */
  async applyWrites(writes: MessageIndexWrite[]): Promise<void> {
    if (writes.length === 0) {
      return;
    }

    // Neither field is a data condition to tolerate; both are broken invariants.
    // An absent `messageId` makes Elasticsearch generate an id, which quietly
    // turns every redelivery into a new document. An absent `tenantId` resolves
    // to `messages-undefined` — a name no alias holds, which Elasticsearch would
    // then create as a concrete index with a dynamic mapping. Callers keep
    // unusable records away from here; this is the backstop that says so aloud.
    const broken = writes.find((write) => {
      const { tenantId, messageId } = identityOf(write);
      return !tenantId || !messageId;
    });
    if (broken) {
      throw new Error(
        `Refusing to write without a messageId and tenantId: ${JSON.stringify(broken)}`,
      );
    }

    const aliases = new Map<string, string>();
    for (const tenantId of new Set(
      writes.map((write) => identityOf(write).tenantId),
    )) {
      aliases.set(tenantId, await this.ensureAlias(tenantId));
    }

    const operations = writes.flatMap<
      estypes.BulkOperationContainer | MessageSearchDocument
    >((write) => {
      const { tenantId, messageId } = identityOf(write);
      const _index = aliases.get(tenantId);

      return write.op === 'index'
        ? [{ index: { _index, _id: messageId } }, write.document]
        : [{ delete: { _index, _id: messageId } }];
    });

    const response = await this.client.bulk({ operations });

    if (response.errors) {
      // Every action type, not just `index`: a delete rejected for load would
      // otherwise pass unnoticed, the offsets would commit, and a message the
      // user deleted would stay searchable. Deleting an id that was never there
      // is not among these — Elasticsearch reports `not_found` without an error.
      const failed = response.items
        .flatMap((item) => Object.values(item))
        .find((result) => result?.error);

      throw new Error(`Indexing failed: ${JSON.stringify(failed?.error)}`);
    }
  }
}
