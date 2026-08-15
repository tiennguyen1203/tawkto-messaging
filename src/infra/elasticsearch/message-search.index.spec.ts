import { MESSAGES_INDEX, messageAliasFor } from '@/common/constants';
import { SearchHelper } from '@/test/search-helper';
import {
  MessageSearchDocument,
  MessageSearchIndex,
} from './message-search.index';

const doc = (
  overrides: Partial<MessageSearchDocument> = {},
): MessageSearchDocument => ({
  messageId: 'm1',
  tenantId: 'tenant-a',
  conversationId: 'c1',
  senderId: 'alice',
  content: 'the quick brown fox jumps',
  timestamp: 1786763181092,
  ...overrides,
});

describe('@infra/elasticsearch/message-search.index', () => {
  const helper = new SearchHelper();
  let index: MessageSearchIndex;

  beforeAll(async () => {
    await helper.setUp();
    index = new MessageSearchIndex(helper.client);
  }, 180_000);

  afterAll(() => helper.tearDown());
  afterEach(() => helper.cleanUp());

  /** Indexing does not refresh, so a spec asks for visibility itself. */
  const indexAndRefresh = async (documents: MessageSearchDocument[]) => {
    await index.indexMany(documents);
    await helper.refresh();
  };

  describe('when a document is indexed for a tenant', () => {
    it('should be findable through that tenant alias', async () => {
      await indexAndRefresh([doc()]);

      const found = await helper.client.search({
        index: messageAliasFor('tenant-a'),
        query: { match: { content: 'brown fox' } },
      });

      expect(found.hits.hits).toHaveLength(1);
      expect(
        (found.hits.hits[0]._source as MessageSearchDocument).messageId,
      ).toBe('m1');
    });

    it('should create the tenant alias over the shared index', async () => {
      await indexAndRefresh([doc()]);

      const aliases = await helper.client.indices.getAlias({
        index: MESSAGES_INDEX,
      });

      expect(Object.keys(aliases[MESSAGES_INDEX].aliases)).toContain(
        messageAliasFor('tenant-a'),
      );
    });
  });

  describe('when the same message is delivered twice', () => {
    it('should overwrite rather than duplicate', async () => {
      // Redelivery is expected, not exceptional: Connect commits offsets every
      // 60s, so a crash replays whatever landed since. Using the message id as
      // the document id is what makes that a no-op.
      await indexAndRefresh([doc({ content: 'first delivery' })]);
      await indexAndRefresh([doc({ content: 'second delivery' })]);

      const found = await helper.client.search({
        index: messageAliasFor('tenant-a'),
        query: { match_all: {} },
      });

      expect(found.hits.hits).toHaveLength(1);
      expect(
        (found.hits.hits[0]._source as MessageSearchDocument).content,
      ).toBe('second delivery');
    });
  });

  describe('when two tenants hold messages with identical content', () => {
    it('should show each tenant only its own', async () => {
      await indexAndRefresh([
        doc({ messageId: 'm-a', tenantId: 'tenant-a' }),
        doc({ messageId: 'm-b', tenantId: 'tenant-b' }),
      ]);

      const forA = await helper.client.search({
        index: messageAliasFor('tenant-a'),
        query: { match: { content: 'brown fox' } },
      });
      const forB = await helper.client.search({
        index: messageAliasFor('tenant-b'),
        query: { match: { content: 'brown fox' } },
      });

      expect(
        forA.hits.hits.map(
          (h) => (h._source as MessageSearchDocument).messageId,
        ),
      ).toEqual(['m-a']);
      expect(
        forB.hits.hits.map(
          (h) => (h._source as MessageSearchDocument).messageId,
        ),
      ).toEqual(['m-b']);
    });

    it('should still hold both in the one shared index', async () => {
      await indexAndRefresh([
        doc({ messageId: 'm-a', tenantId: 'tenant-a' }),
        doc({ messageId: 'm-b', tenantId: 'tenant-b' }),
      ]);

      const all = await helper.client.count({ index: MESSAGES_INDEX });

      expect(all.count).toBe(2);
    });
  });

  describe('when a document carries a field the mapping does not know', () => {
    it('should fail loudly rather than drop it', async () => {
      // `dynamic: strict` is what stops an unnoticed change to the stored
      // document from silently landing unindexed data in production. `__deleted`
      // is not hypothetical — Debezium's unwrap transform adds it to every record.
      await expect(
        index.indexMany([
          { ...doc(), __deleted: false } as MessageSearchDocument,
        ]),
      ).rejects.toThrow(/strict_dynamic_mapping_exception/);
    });
  });

  describe('when the batch is empty', () => {
    it('should do nothing rather than send an empty bulk request', async () => {
      await expect(index.indexMany([])).resolves.toBeUndefined();
    });
  });
});
