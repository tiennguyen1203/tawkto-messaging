import { messageAliasFor } from '@/common/constants';
import {
  MessageSearchDocument,
  MessageSearchIndex,
} from '@/infra/elasticsearch/message-search.index';
import { SearchHelper } from '@/test/search-helper';
import { MessageCreatedHandler } from './handler';
import { MessageCreatedEvent } from './message-created.event';

describe('@consumers/message-created/handler', () => {
  const helper = new SearchHelper('handler-spec');
  const TENANT_A = helper.tenant('a');
  const TENANT_B = helper.tenant('b');
  let handler: MessageCreatedHandler;

  const event = (
    overrides: Partial<MessageCreatedEvent> = {},
  ): MessageCreatedEvent => ({
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
  });

  beforeAll(async () => {
    await helper.setUp();
    handler = new MessageCreatedHandler(new MessageSearchIndex(helper.client));
  }, 180_000);

  afterAll(() => helper.tearDown());
  afterEach(() => helper.cleanUp());

  const handleAndRefresh = async (events: MessageCreatedEvent[]) => {
    await handler.handleBatch(events);
    await helper.refresh();
  };

  const indexedIds = async (tenantId = TENANT_A) => {
    const found = await helper.client.search<MessageSearchDocument>({
      index: messageAliasFor(tenantId),
      query: { match_all: {} },
    });
    return found.hits.hits.map((hit) => hit._source!.messageId).sort();
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
    it('should index the inserts and skip the deletion', async () => {
      // The transform reports the flag as a boolean or as a string depending on
      // the converter, so both spellings have to be understood.
      await handleAndRefresh([
        event({ _id: 'kept' }),
        event({ _id: 'gone', __deleted: true }),
        event({ _id: 'also-gone', __deleted: 'true' }),
      ]);

      expect(await indexedIds()).toEqual(['kept']);
    });
  });

  describe('when the whole batch is deletions', () => {
    it('should send no request at all', async () => {
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
    const malformed = (overrides: Partial<MessageCreatedEvent>) =>
      ({ ...event(), ...overrides }) as MessageCreatedEvent;

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
