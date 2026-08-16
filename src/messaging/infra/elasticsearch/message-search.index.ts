import { Client, estypes } from '@elastic/elasticsearch';
import { Injectable } from '@nestjs/common';

import { MESSAGES_INDEX, messageAliasFor } from '@/messaging/common/constants';
import {
  decodeCursor,
  encodeCursor,
  PageResult,
} from '@/shared/pagination/cursor';

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

export type MessageSearchQuery = {
  tenantId: string;
  conversationId: string;
  /**
   * The text to match against message content.
   *
   * Not called `term`: Elasticsearch's `term` is an exact, unanalysed lookup —
   * the opposite of what this does — and the two would sit two lines apart in
   * the query below.
   */
  text: string;
  limit: number;
  cursor?: string;
};

/**
 * `total` is required here where the listing endpoint omits it: Elasticsearch
 * reports a hit count as a by-product of the query, whereas counting a keyset
 * page in MongoDB would be a second, unbounded scan (ADR-004).
 */
export type MessageSearchPage = PageResult<MessageSearchDocument> & {
  total: number;
};

/**
 * The `sort` tuple Elasticsearch echoes back for a hit — the score, then the
 * tie-breaking message id. Opaque to callers, which is why it travels encoded.
 */
type SearchCursor = [number, string];

/**
 * Counting every hit exactly costs a full scan. Ten thousand is far past what a
 * person reads, and the response says the number is approximate (ADR-004).
 */
const TOTAL_HITS_CEILING = 10_000;

const identityOf = (write: MessageIndexWrite) =>
  write.op === 'index'
    ? { tenantId: write.document.tenantId, messageId: write.document.messageId }
    : { tenantId: write.tenantId, messageId: write.messageId };

/**
 * How far the thumb goes on the scale for a document containing the word as typed.
 * Three is enough to lift an exact hit in a long message above a near miss in a
 * short one, which is the case that motivated it.
 */
const EXACT_MATCH_BOOST = 3;

/** Characters that must match before edits are considered. */
const FUZZY_PREFIX_LENGTH = 1;

/** Ceiling on the terms one fuzzy term may expand into. Elasticsearch's default. */
const FUZZY_MAX_EXPANSIONS = 50;

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

  /**
   * Full-text search within one conversation, paginated with `search_after`.
   *
   * `from`/`size` would be simpler but caps out at 10,000 results and pays to
   * re-walk every skipped hit; `search_after` costs the same at page 500 as at
   * page 1. The trade-off is that pages can only be walked forward (ADR-004).
   *
   * Reads never provision. A tenant with nothing indexed has no alias, and
   * `ignore_unavailable` turns that into an empty page rather than an error —
   * creating the alias here would make a search quietly write to the cluster.
   */
  async search(query: MessageSearchQuery): Promise<MessageSearchPage> {
    const after = decodeCursor<SearchCursor>(query.cursor);

    const response = await this.client.search<MessageSearchDocument>({
      index: messageAliasFor(query.tenantId),
      ignore_unavailable: true,
      allow_no_indices: true,
      // One more than asked for: its presence is what says another page exists,
      // without a second query to count.
      size: query.limit + 1,
      track_total_hits: TOTAL_HITS_CEILING,
      query: {
        bool: {
          // `conversationId` filters rather than matches: it is a keyword, the
          // clause contributes no score, and a filter clause is cacheable.
          filter: [{ term: { conversationId: query.conversationId } }],
          // Two clauses: what you typed, boosted, and what you might have meant.
          //
          // A single fuzzy clause is not enough, and the reason is field-length
          // normalisation rather than IDF. Measured on a real cluster: searching
          // `bravo` against a long message containing `bravo` and a short one
          // containing `bravos` scores the short near-miss 0.91 and the exact hit
          // 0.50 — the document with the word you actually typed comes second. The
          // boosted exact clause puts it back on top at 1.99.
          //
          // This is not a guarantee, and it is not meant to be: a long enough document
          // still loses to a short variant. It is a thumb on the scale in the
          // direction of what the reader asked for.
          should: [
            {
              match: {
                content: { query: query.text, boost: EXACT_MATCH_BOOST },
              },
            },
            {
              match: {
                content: {
                  query: query.text,
                  // AUTO is per term, by length: no edits below three characters, one
                  // up to five, two beyond. A blanket 2 makes every short word a match
                  // for every other short word.
                  fuzziness: 'AUTO',
                  // The first character must be right. It is what keeps a fuzzy term
                  // from expanding across the dictionary; the cost is that a typo in
                  // the *first* letter is not forgiven, and typos rarely are.
                  prefix_length: FUZZY_PREFIX_LENGTH,
                  max_expansions: FUZZY_MAX_EXPANSIONS,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      },
      // `_score` alone is not a stable order — equal scores may come back in any
      // order, and a page boundary in the middle of a tie would repeat or skip a
      // hit. `messageId` breaks the tie with a value that never repeats.
      sort: [{ _score: { order: 'desc' } }, { messageId: { order: 'asc' } }],
      ...(after ? { search_after: after } : {}),
    });

    const hits = response.hits.hits;
    const hasMore = hits.length > query.limit;
    const page = hasMore ? hits.slice(0, query.limit) : hits;
    const last = page[page.length - 1];

    return {
      items: page.map((hit) => hit._source!),
      nextCursor:
        hasMore && last?.sort ? encodeCursor(last.sort as SearchCursor) : null,
      hasMore,
      total:
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? 0),
    };
  }
}
