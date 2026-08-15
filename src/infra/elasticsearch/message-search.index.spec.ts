import { MESSAGES_INDEX, messageAliasFor } from '@/common/constants';
import { SearchHelper } from '@/test/search-helper';
import {
  MessageSearchDocument,
  MessageSearchIndex,
} from './message-search.index';

describe('@infra/elasticsearch/message-search.index', () => {
  const helper = new SearchHelper('index-spec');
  const TENANT_A = helper.tenant('a');
  const TENANT_B = helper.tenant('b');
  let index: MessageSearchIndex;

  const doc = (
    overrides: Partial<MessageSearchDocument> = {},
  ): MessageSearchDocument => ({
    messageId: 'm1',
    tenantId: TENANT_A,
    conversationId: 'c1',
    senderId: 'alice',
    content: 'the quick brown fox jumps',
    timestamp: 1786763181092,
    ...overrides,
  });

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

  const idsUnder = async (alias: string, query: object = { match_all: {} }) => {
    const found = await helper.client.search<MessageSearchDocument>({
      index: alias,
      query,
    });
    return found.hits.hits.map((hit) => hit._source!.messageId).sort();
  };

  describe('when a document is indexed for a tenant', () => {
    it('should be findable through that tenant alias', async () => {
      await indexAndRefresh([doc()]);

      expect(
        await idsUnder(messageAliasFor(TENANT_A), {
          match: { content: 'brown fox' },
        }),
      ).toEqual(['m1']);
    });

    it('should create the tenant alias over the shared index', async () => {
      await indexAndRefresh([doc()]);

      const aliases = await helper.client.indices.getAlias({
        index: MESSAGES_INDEX,
      });

      expect(Object.keys(aliases[MESSAGES_INDEX].aliases)).toContain(
        messageAliasFor(TENANT_A),
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

      const found = await helper.client.search<MessageSearchDocument>({
        index: messageAliasFor(TENANT_A),
        query: { match_all: {} },
      });

      expect(found.hits.hits).toHaveLength(1);
      expect(found.hits.hits[0]._source!.content).toBe('second delivery');
    });
  });

  describe('when two tenants hold messages with identical content', () => {
    it('should show each tenant only its own', async () => {
      await indexAndRefresh([
        doc({ messageId: 'm-a', tenantId: TENANT_A }),
        doc({ messageId: 'm-b', tenantId: TENANT_B }),
      ]);

      const query = { match: { content: 'brown fox' } };
      expect(await idsUnder(messageAliasFor(TENANT_A), query)).toEqual(['m-a']);
      expect(await idsUnder(messageAliasFor(TENANT_B), query)).toEqual(['m-b']);
    });

    it('should still hold both in the one shared index', async () => {
      await indexAndRefresh([
        doc({ messageId: 'm-a', tenantId: TENANT_A }),
        doc({ messageId: 'm-b', tenantId: TENANT_B }),
      ]);

      expect(await helper.count()).toBe(2);
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

  describe('when a document has no id of its own', () => {
    it('should refuse the batch rather than let Elasticsearch invent one', async () => {
      // An invented id is not a visible failure, it is a silent one: the write
      // succeeds, and the next redelivery of the same message writes a second
      // document instead of overwriting the first.
      await expect(
        index.indexMany([doc({ messageId: undefined as unknown as string })]),
      ).rejects.toThrow(/without a messageId and tenantId/);
    });

    it('should refuse a document with no tenant, which would route to messages-undefined', async () => {
      await expect(
        index.indexMany([doc({ tenantId: undefined as unknown as string })]),
      ).rejects.toThrow(/without a messageId and tenantId/);
    });
  });

  describe('when the batch is empty', () => {
    it('should do nothing rather than send an empty bulk request', async () => {
      await expect(index.indexMany([])).resolves.toBeUndefined();
    });
  });
});
