import { messageAliasFor } from '@/common/constants';
import {
  MessageSearchDocument,
  MessageSearchIndex,
} from '@/infra/elasticsearch/message-search.index';
import { SearchHelper } from '@/test/search-helper';
import { MessageChangeHandler } from './handler';
import { MessageChangeEvent } from './message-changed.event';

describe('@consumers/message-changed/handler', () => {
  const helper = new SearchHelper('handler-spec');
  const TENANT_A = helper.tenant('a');
  const TENANT_B = helper.tenant('b');
  let handler: MessageChangeHandler;

  const event = (
    overrides: Partial<MessageChangeEvent> = {},
  ): MessageChangeEvent => {
    const base: MessageChangeEvent = {
      _id: 'm1',
      tenantId: TENANT_A,
      conversationId: 'c1',
      senderId: 'alice',
      content: 'charlie delta echo',
      timestamp: 1786763181092,
      createdAt: 1786763181093,
      updatedAt: 1786763181093,
      __deleted: false,
      ...overrides,
    };
    // `_id` becomes the Elasticsearch document id, which is global to the index.
    return { ...base, _id: helper.id(base._id) };
  };

  beforeAll(async () => {
    await helper.setUp();
    handler = new MessageChangeHandler(new MessageSearchIndex(helper.client));
  }, 180_000);

  afterAll(() => helper.tearDown());
  afterEach(() => helper.cleanUp());

  const handleAndRefresh = async (events: MessageChangeEvent[]) => {
    await handler.handleBatch(events);
    await helper.refresh();
  };

  const indexedIds = async (tenantId = TENANT_A) => {
    const found = await helper.client.search<MessageSearchDocument>({
      index: messageAliasFor(tenantId),
      query: { match_all: {} },
    });
    return found.hits.hits
      .map((hit) => helper.plain(hit._source!.messageId))
      .sort();
  };

  describe('when a batch of inserts arrives', () => {
    it('should index every message in it', async () => {
      await handleAndRefresh([
        event({ _id: 'm1' }),
        event({ _id: 'm2' }),
        event({ _id: 'm3' }),
      ]);

      expect(await indexedIds()).toEqual(['m1', 'm2', 'm3']);
    });
  });

  describe('when the batch contains a deletion', () => {
    it('should remove the deleted message and keep the rest', async () => {
      // The transform reports the flag as a boolean or as a string depending on
      // the converter, so both spellings have to be understood.
      await handleAndRefresh([
        event({ _id: 'kept' }),
        event({ _id: 'gone' }),
        event({ _id: 'also-gone' }),
      ]);
      await handleAndRefresh([
        event({ _id: 'gone', __deleted: true }),
        event({ _id: 'also-gone', __deleted: 'true' }),
      ]);

      expect(await indexedIds()).toEqual(['kept']);
    });
  });

  describe('when one message is created, edited and deleted in a single batch', () => {
    it('should leave nothing behind', async () => {
      // A client hammering the API can produce all three inside one batch window.
      // The writes are applied in the order the events arrived, so the deletion
      // lands last and wins.
      await handleAndRefresh([
        event({ _id: 'ephemeral', content: 'created' }),
        event({ _id: 'ephemeral', content: 'edited' }),
        event({ _id: 'ephemeral', __deleted: true }),
      ]);

      expect(await indexedIds()).toEqual([]);
    });
  });

  describe('when a message is edited twice in one batch', () => {
    it('should keep the later content', async () => {
      await handleAndRefresh([
        event({ _id: 'm1', content: 'older' }),
        event({ _id: 'm1', content: 'newer' }),
      ]);

      const found = await helper.client.search<MessageSearchDocument>({
        index: messageAliasFor(TENANT_A),
        query: { match_all: {} },
      });

      expect(found.hits.hits[0]._source!.content).toBe('newer');
    });
  });

  describe('when the whole batch is deletions of messages never indexed', () => {
    it('should complete without failing the batch', async () => {
      await handleAndRefresh([event({ __deleted: true })]);

      expect(await indexedIds()).toEqual([]);
    });
  });

  describe('when the same batch is delivered twice', () => {
    it('should leave one document per message', async () => {
      // Connect commits offsets periodically, so a crash replays whatever landed
      // since the last commit. Redelivery has to be a no-op, not a duplicate.
      const batch = [event({ _id: 'm1' }), event({ _id: 'm2' })];

      await handleAndRefresh(batch);
      await handleAndRefresh(batch);

      expect(await indexedIds()).toEqual(['m1', 'm2']);
    });
  });

  describe('when a record is missing the fields the index needs', () => {
    // Not hypothetical: the M2 connector briefly renamed `_id` to `id`, and those
    // records are still on the topic. Left unguarded they index under an
    // Elasticsearch-generated id, so every replay writes another copy — the
    // at-least-once pipeline stops being idempotent without a single error.
    const malformed = (overrides: Partial<MessageChangeEvent>) =>
      ({ ...event(), ...overrides }) as MessageChangeEvent;

    it('should index the sound records and skip the rest', async () => {
      await handleAndRefresh([
        event({ _id: 'good' }),
        malformed({ _id: undefined as unknown as string }),
        malformed({ tenantId: undefined as unknown as string }),
        malformed({ conversationId: undefined as unknown as string }),
      ]);

      expect(await indexedIds()).toEqual(['good']);
    });

    it('should not let a replay of them accumulate documents', async () => {
      const batch = [
        event({ _id: 'good' }),
        malformed({ _id: undefined as unknown as string }),
      ];

      await handleAndRefresh(batch);
      await handleAndRefresh(batch);
      await handleAndRefresh(batch);

      expect(await helper.count()).toBe(1);
    });
  });

  describe('when the batch spans tenants', () => {
    it('should put each tenant messages behind its own alias', async () => {
      // One Kafka batch can hold several partitions, and partitions are keyed by
      // conversation — nothing keeps a batch to a single tenant.
      await handleAndRefresh([
        event({ _id: 'm-a', tenantId: TENANT_A }),
        event({ _id: 'm-b', tenantId: TENANT_B }),
      ]);

      expect(await indexedIds(TENANT_A)).toEqual(['m-a']);
      expect(await indexedIds(TENANT_B)).toEqual(['m-b']);
    });
  });
});
