/**
 * Rebuilds the Elasticsearch projection from MongoDB, which is the source of truth.
 *
 *   pnpm es:reindex            # write every message into the index
 *   pnpm es:reindex --prune    # and delete index documents with no message behind them
 *   pnpm es:reindex --dry-run  # say what it would do, change nothing
 *
 * **Why this exists.** The connector runs with `snapshot.mode: no_data`: it streams
 * changes from the moment it starts and never reads what is already in the
 * collection. Kafka retention is finite on top of that. So the log is not a complete
 * history of the collection, and a read model whose log cannot replay it is a read
 * model that cannot be rebuilt — until this.
 *
 * It found its first real gap the honest way: someone counted 392 messages in Mongo
 * against 200 documents in Elasticsearch. Every one of the missing predated the
 * period when the stack was being torn down and rebuilt, and every message written
 * since was present. The pipeline was healthy; the history was not.
 *
 * **The trade-off it accepts.** This writes to the index directly rather than
 * replaying through Kafka, so for the duration of a rebuild there are two writers.
 * That is safe here because a write is an overwrite keyed by message id — the
 * consumer and this script cannot produce different documents for the same message —
 * and the alternative, re-registering the connector with `snapshot.mode: initial`,
 * floods the topic with the entire collection and is far heavier to operate. The
 * cleaner answer for a real deployment is written down in the README.
 */
import { Client } from '@elastic/elasticsearch';
import mongoose from 'mongoose';

import { MESSAGES_INDEX } from '@/messaging/common/constants';
import { MessageSearchIndex } from '@/messaging/infra/elasticsearch/message-search.index';
import type { MessageIndexWrite } from '@/messaging/infra/elasticsearch/message-search.index';

const MONGO_URI =
  process.env.MONGO_URI ??
  'mongodb://localhost:27018/messaging?directConnection=true';
const ES_NODE = process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';

/** Big enough to be worth a round trip, small enough not to build a huge request. */
const BATCH_SIZE = 500;

const dryRun = process.argv.includes('--dry-run');

/**
 * Deleting is the dangerous direction, so it is opt-in and only ever runs after a
 * complete scan. A run that died half way through would otherwise decide that
 * everything it had not reached yet was orphaned.
 */
const prune = process.argv.includes('--prune');

type MessageRow = {
  _id: { toString(): string };
  tenantId: string;
  conversationId: { toString(): string };
  senderId: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

const toWrite = (row: MessageRow): MessageIndexWrite => ({
  op: 'index',
  document: {
    messageId: row._id.toString(),
    tenantId: row.tenantId,
    conversationId: row.conversationId.toString(),
    senderId: row.senderId,
    content: row.content,
    // Epoch milliseconds, matching the index mapping — the same conversion the
    // consumer does, because this uses the same document type.
    timestamp: row.timestamp.getTime(),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  },
});

/**
 * Removes index documents whose message is no longer in MongoDB.
 *
 * A message deleted from the source but left in the projection is still findable by
 * search, which is the wrong answer to give about content somebody removed.
 */
const pruneOrphans = async (
  client: Client,
  index: MessageSearchIndex,
  seen: Set<string>,
  scanned: number,
): Promise<void> => {
  await client.indices.refresh({ index: MESSAGES_INDEX });

  const orphans: MessageIndexWrite[] = [];
  let searchAfter: unknown[] | undefined;

  // Paged by _id rather than scrolled: no cursor to keep alive on the cluster, and
  // the order is total, so nothing is seen twice or skipped.
  for (;;) {
    const page = await client.search<{ messageId: string; tenantId: string }>({
      index: MESSAGES_INDEX,
      size: 1000,
      _source: ['messageId', 'tenantId'],
      sort: [{ messageId: 'asc' }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
    });

    const hits = page.hits.hits;
    if (hits.length === 0) {
      break;
    }

    for (const hit of hits) {
      const source = hit._source;
      if (source && !seen.has(source.messageId)) {
        orphans.push({
          op: 'delete',
          tenantId: source.tenantId,
          messageId: source.messageId,
        });
      }
    }

    searchAfter = hits[hits.length - 1]?.sort;
  }

  if (orphans.length === 0) {
    console.log(`No orphans: every indexed document has a message behind it.`);
    return;
  }

  console.log(
    `${orphans.length} indexed document(s) have no message in MongoDB (scanned ${scanned}).`,
  );
  for (const orphan of orphans.slice(0, 10)) {
    if (orphan.op === 'delete') {
      console.log(`  ${orphan.messageId}  tenant=${orphan.tenantId}`);
    }
  }

  if (dryRun) {
    console.log('Dry run: none deleted.');
    return;
  }

  await index.applyWrites(orphans);
  console.log(`Deleted ${orphans.length}.`);
};

const main = async (): Promise<void> => {
  const connection = await mongoose.createConnection(MONGO_URI).asPromise();
  const client = new Client({ node: ES_NODE });
  const index = new MessageSearchIndex(client);

  try {
    const collection = connection.collection<MessageRow>('messages');
    const total = await collection.countDocuments();
    console.log(`MongoDB holds ${total} messages.`);

    let scanned = 0;
    let written = 0;
    let batch: MessageIndexWrite[] = [];
    // Held in memory, which is the one thing here that does not scale to a very
    // large collection. At that size the prune belongs in a query — "delete by
    // query, indexed before this run started" — rather than in a set of ids.
    const seen = new Set<string>();

    const flush = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }
      if (!dryRun) {
        // The same call the consumer makes, so there is one definition of what a
        // message looks like in the index and one place that can be wrong about it.
        await index.applyWrites(batch);
      }
      written += batch.length;
      batch = [];
      process.stdout.write(`\r  indexed ${written} / ${total}`);
    };

    // Sorted by _id so a run that dies part way through can be reasoned about, and
    // streamed rather than loaded: the collection does not have to fit in memory.
    const cursor = collection.find({}, { sort: { _id: 1 } }).stream();

    for await (const row of cursor) {
      scanned += 1;
      const write = toWrite(row as MessageRow);
      seen.add(write.op === 'index' ? write.document.messageId : '');
      batch.push(write);
      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
    }
    await flush();

    process.stdout.write('\n');
    console.log(
      dryRun
        ? `Dry run: ${scanned} messages would be written.`
        : `Done: ${written} messages written.`,
    );

    if (prune) {
      await pruneOrphans(client, index, seen, scanned);
    }

    if (!dryRun) {
      // Refresh so the count below is the count, rather than whatever happens to
      // have been flushed to a segment already.
      await client.indices.refresh({ index: MESSAGES_INDEX });
      const { count } = await client.count({ index: MESSAGES_INDEX });
      console.log(`Elasticsearch now holds ${count} documents.`);

      if (count < total) {
        // Not necessarily wrong — the index can hold documents for messages since
        // deleted — but it is never right for it to hold fewer than the source.
        console.error(
          `\nStill short by ${total - count}. Something rejected those writes; check the log above.`,
        );
        process.exitCode = 1;
      }
    }
  } finally {
    await connection.close();
    await client.close();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
