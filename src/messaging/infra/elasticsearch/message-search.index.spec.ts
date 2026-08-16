import { MESSAGES_INDEX, messageAliasFor } from '@/messaging/common/constants';
import { SearchHelper } from '@/messaging/test/search-helper';
import {
  MessageIndexWrite,
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
  ): MessageSearchDocument => {
    const base: MessageSearchDocument = {
      messageId: 'm1',
      tenantId: TENANT_A,
      conversationId: 'c1',
      senderId: 'alice',
      content: 'the quick brown fox jumps',
      timestamp: 1786763181092,
      ...overrides,
    };
    // `_id` is global to the index, so it carries this file's namespace too.
    return { ...base, messageId: helper.id(base.messageId) };
  };

  const write = (
    overrides: Partial<MessageSearchDocument> = {},
  ): MessageIndexWrite => ({ op: 'index', document: doc(overrides) });

  const remove = (
    messageId: string,
    tenantId = TENANT_A,
  ): MessageIndexWrite => ({
    op: 'delete',
    tenantId,
    messageId: helper.id(messageId),
  });

  beforeAll(async () => {
    await helper.setUp();
    index = new MessageSearchIndex(helper.client);
  }, 180_000);

  afterAll(() => helper.tearDown());
  afterEach(() => helper.cleanUp());

  /** Writing does not refresh, so a spec asks for visibility itself. */
  const applyAndRefresh = async (writes: MessageIndexWrite[]) => {
    await index.applyWrites(writes);
    await helper.refresh();
  };

  const idsUnder = async (
    tenantId = TENANT_A,
    query: object = { match_all: {} },
  ) => {
    const found = await helper.client.search<MessageSearchDocument>({
      index: messageAliasFor(tenantId),
      query,
    });
    return found.hits.hits
      .map((hit) => helper.plain(hit._source!.messageId))
      .sort();
  };

  describe('when a document is written for a tenant', () => {
    it('should be findable through that tenant alias', async () => {
      await applyAndRefresh([write()]);

      expect(
        await idsUnder(TENANT_A, { match: { content: 'brown fox' } }),
      ).toEqual(['m1']);
    });

    it('should create the tenant alias over the shared index', async () => {
      await applyAndRefresh([write()]);

      const aliases = await helper.client.indices.getAlias({
        index: MESSAGES_INDEX,
      });

      expect(Object.keys(aliases[MESSAGES_INDEX].aliases)).toContain(
        messageAliasFor(TENANT_A),
      );
    });
  });

  describe('when the same message is written twice', () => {
    it('should overwrite rather than duplicate', async () => {
      // Redelivery is expected, not exceptional: Connect commits offsets
      // periodically, so a crash replays whatever landed since. Using the message
      // id as the document id is what makes that a no-op.
      await applyAndRefresh([write({ content: 'first delivery' })]);
      await applyAndRefresh([write({ content: 'second delivery' })]);

      const found = await helper.client.search<MessageSearchDocument>({
        index: messageAliasFor(TENANT_A),
        query: { match_all: {} },
      });

      expect(found.hits.hits).toHaveLength(1);
      expect(found.hits.hits[0]._source!.content).toBe('second delivery');
    });
  });

  describe('when writes for one message are ordered within a batch', () => {
    // The order of `writes` is the contract. Grouping the operations by tenant or
    // splitting them into concurrent chunks would break these two and nothing
    // else — which is exactly why they exist.
    it('should leave the message deleted when the deletion comes last', async () => {
      await applyAndRefresh([
        write({ messageId: 'm1', content: 'created' }),
        write({ messageId: 'm1', content: 'edited' }),
        remove('m1'),
      ]);

      expect(await idsUnder()).toEqual([]);
    });

    it('should leave the message present when a write comes after the deletion', async () => {
      await applyAndRefresh([
        remove('m1'),
        write({ messageId: 'm1', content: 'written after the delete' }),
      ]);

      expect(await idsUnder()).toEqual(['m1']);
    });

    it('should keep the last content when a message is edited twice', async () => {
      await applyAndRefresh([
        write({ messageId: 'm1', content: 'older' }),
        write({ messageId: 'm1', content: 'newer' }),
      ]);

      const found = await helper.client.get<MessageSearchDocument>({
        index: MESSAGES_INDEX,
        id: helper.id('m1'),
        routing: TENANT_A,
      });

      expect(found._source!.content).toBe('newer');
    });
  });

  describe('when a deletion is applied', () => {
    it('should remove a document written by an earlier batch', async () => {
      await applyAndRefresh([write({ messageId: 'gone' })]);
      expect(await idsUnder()).toEqual(['gone']);

      await applyAndRefresh([remove('gone')]);

      expect(await idsUnder()).toEqual([]);
    });

    it('should treat a message that was never indexed as nothing to do', async () => {
      // Deleting an id Elasticsearch has never seen answers `not_found`, which is
      // not an error — a create and a delete inside one batch collapse to exactly
      // this, and it must not fail the batch.
      await expect(
        index.applyWrites([remove('never-existed')]),
      ).resolves.toBeUndefined();
    });
  });

  describe('when a deletion itself fails', () => {
    it('should surface the error rather than report the batch as done', async () => {
      // A delete that Elasticsearch rejects — for load, for a misconfigured
      // alias — must fail the batch. Swallowed, the offsets commit and a message
      // the user deleted stays searchable forever. Pointing the alias at a second
      // index is the cheapest way to make a write through it genuinely fail.
      const alias = messageAliasFor(TENANT_A);
      const decoy = `${MESSAGES_INDEX}-decoy`;

      await index.ensureAlias(TENANT_A);
      await helper.client.indices.create({ index: decoy });
      await helper.client.indices.putAlias({ index: decoy, name: alias });

      try {
        // Matching on the reason Elasticsearch gave, not merely on our own
        // prefix: an error check that looked at `index` results alone would
        // still throw here, just with `undefined` where the cause should be.
        await expect(index.applyWrites([remove('m1')])).rejects.toThrow(
          /illegal_argument_exception/,
        );
      } finally {
        await helper.client.indices.deleteAlias({ index: decoy, name: alias });
        await helper.client.indices.delete({ index: decoy });
      }
    });
  });

  describe('when the batch spans tenants', () => {
    it('should show each tenant only its own', async () => {
      await applyAndRefresh([
        write({ messageId: 'm-a', tenantId: TENANT_A }),
        write({ messageId: 'm-b', tenantId: TENANT_B }),
      ]);

      const query = { match: { content: 'brown fox' } };
      expect(await idsUnder(TENANT_A, query)).toEqual(['m-a']);
      expect(await idsUnder(TENANT_B, query)).toEqual(['m-b']);
    });

    it('should delete only from the tenant that asked', async () => {
      await applyAndRefresh([
        write({ messageId: 'shared-id', tenantId: TENANT_A }),
        write({ messageId: 'other', tenantId: TENANT_B }),
      ]);

      await applyAndRefresh([remove('shared-id', TENANT_A)]);

      expect(await idsUnder(TENANT_A)).toEqual([]);
      expect(await idsUnder(TENANT_B)).toEqual(['other']);
    });

    it('should still hold everything in the one shared index', async () => {
      await applyAndRefresh([
        write({ messageId: 'm-a', tenantId: TENANT_A }),
        write({ messageId: 'm-b', tenantId: TENANT_B }),
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
        index.applyWrites([
          {
            op: 'index',
            document: { ...doc(), __deleted: false } as MessageSearchDocument,
          },
        ]),
      ).rejects.toThrow(/strict_dynamic_mapping_exception/);
    });
  });

  describe('when a write has no identity', () => {
    it('should refuse a document without an id rather than let Elasticsearch invent one', async () => {
      // An invented id is not a visible failure, it is a silent one: the write
      // succeeds, and the next redelivery of the same message writes a second
      // document instead of overwriting the first.
      // Built literally: `doc` namespaces the id, which would turn the missing
      // one into a perfectly truthy string and defeat the guard being tested.
      await expect(
        index.applyWrites([
          {
            op: 'index',
            document: {
              ...doc(),
              messageId: undefined as unknown as string,
            },
          },
        ]),
      ).rejects.toThrow(/without a messageId and tenantId/);
    });

    it('should refuse a document with no tenant, which would route to messages-undefined', async () => {
      await expect(
        index.applyWrites([
          write({ tenantId: undefined as unknown as string }),
        ]),
      ).rejects.toThrow(/without a messageId and tenantId/);
    });

    it('should refuse a deletion with no tenant, which would look in the wrong shard', async () => {
      // Built literally rather than through `remove`, whose default parameter
      // would quietly substitute a real tenant for the undefined one.
      await expect(
        index.applyWrites([
          {
            op: 'delete',
            messageId: helper.id('m1'),
            tenantId: undefined as unknown as string,
          },
        ]),
      ).rejects.toThrow(/without a messageId and tenantId/);
    });
  });

  describe('#search', () => {
    const seed = (count: number, tenantId = TENANT_A, conversationId = 'c1') =>
      applyAndRefresh(
        Array.from({ length: count }, (_, i) =>
          write({
            messageId: `${conversationId}-${i}`,
            tenantId,
            conversationId,
            content: `alpha bravo message number ${i}`,
            timestamp: 1_786_763_181_000 + i,
          }),
        ),
      );

    const ask = (overrides: Partial<Parameters<typeof index.search>[0]> = {}) =>
      index.search({
        tenantId: TENANT_A,
        conversationId: 'c1',
        text: 'bravo',
        limit: 10,
        ...overrides,
      });

    describe('when a term matches', () => {
      it('should return the matching messages', async () => {
        await seed(3);

        const page = await ask();

        expect(page.items).toHaveLength(3);
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeNull();
        expect(page.total).toBe(3);
      });
    });

    describe('when the term is misspelled', () => {
      it('should still find it', async () => {
        await seed(3);

        // One transposition. Search is how anyone finds anything here, and a
        // search that answers nothing because a finger slipped is a search people
        // stop using.
        expect((await ask({ text: 'brvao' })).items).toHaveLength(3);
      });

      it('should rank an exact hit above a near miss in a shorter message', async () => {
        // The length difference is the whole test. With messages of similar length
        // the engine gets this right by itself, which is why an earlier version of
        // this test passed with the boosted clause deleted and said nothing useful.
        //
        // Field-length normalisation is what breaks it: measured on a real cluster,
        // a single fuzzy clause scores the short near miss 0.91 and the long exact
        // hit 0.50. The reader typed the word that is in the second one.
        await applyAndRefresh([
          write({
            messageId: 'long-exact',
            content:
              'bravo lorem ipsum dolor sit amet consectetur adipiscing elit sed do ' +
              'eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad ' +
              'minim veniam quis nostrud exercitation ullamco laboris nisi aliquip',
            timestamp: 1_786_763_181_000,
          }),
          write({
            messageId: 'short-fuzzy',
            content: 'bravos',
            timestamp: 1_786_763_182_000,
          }),
        ]);

        const page = await ask({ text: 'bravo' });

        expect(page.items.map((item) => item.messageId)).toEqual([
          helper.id('long-exact'),
          helper.id('short-fuzzy'),
        ]);
      });

      it('should not forgive a typo in the first letter', async () => {
        await seed(3);

        // The cost of `prefix_length: 1`, stated out loud: it is what keeps a fuzzy
        // term from expanding across the dictionary, and typos are rarely first.
        expect((await ask({ text: 'xravo' })).items).toEqual([]);
      });

      it('should not forgive anything in a very short word', async () => {
        await applyAndRefresh([
          write({
            messageId: 'short',
            content: 'ok then',
            timestamp: 1_786_763_181_000,
          }),
        ]);

        // AUTO allows no edits below three characters. Otherwise every two-letter
        // word matches every other one, and the results are noise.
        expect((await ask({ text: 'oz' })).items).toEqual([]);
      });
    });

    describe('when the term appears in no message', () => {
      it('should return an empty page', async () => {
        await seed(3);

        expect((await ask({ text: 'zulu' })).items).toEqual([]);
      });
    });

    describe('when another tenant holds identical content', () => {
      it('should not return it', async () => {
        await seed(2, TENANT_A);
        await seed(2, TENANT_B);

        const page = await ask({ limit: 50 });

        expect(page.items).toHaveLength(2);
        expect(page.items.every((m) => m.tenantId === TENANT_A)).toBe(true);
      });
    });

    describe('when another conversation in the same tenant matches', () => {
      it('should not return it', async () => {
        await seed(2, TENANT_A, 'c1');
        await seed(2, TENANT_A, 'c2');

        const page = await ask({ limit: 50 });

        expect(page.items.every((m) => m.conversationId === 'c1')).toBe(true);
      });
    });

    describe('when there are more hits than the page size', () => {
      it('should walk every hit exactly once across pages', async () => {
        // Every message scores identically here, which is the case a sort on
        // `_score` alone gets wrong: without the messageId tiebreaker the page
        // boundary falls inside a tie and hits repeat or vanish.
        await seed(7);

        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;

        do {
          const page = await ask({ limit: 3, cursor });
          seen.push(...page.items.map((m) => m.messageId));
          cursor = page.nextCursor ?? undefined;
          pages += 1;
        } while (cursor && pages < 10);

        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);
      });
    });

    describe('when the cursor cannot be read', () => {
      it('should serve the first page rather than failing', async () => {
        await seed(2);

        expect((await ask({ cursor: 'not-a-real-cursor' })).items).toHaveLength(
          2,
        );
      });
    });

    describe('when the tenant has never been indexed', () => {
      it('should return an empty page rather than a missing-index error', async () => {
        const page = await ask({ tenantId: helper.tenant('never-seen') });

        expect(page.items).toEqual([]);
        expect(page.hasMore).toBe(false);
        expect(page.total).toBe(0);
      });

      it('should not create an alias, because reading must not provision', async () => {
        const tenantId = helper.tenant('read-only');

        await ask({ tenantId });

        const exists = await helper.client.indices.existsAlias({
          name: messageAliasFor(tenantId),
        });
        expect(exists).toBe(false);
      });
    });
  });

  describe('when the batch is empty', () => {
    it('should do nothing rather than send an empty bulk request', async () => {
      await expect(index.applyWrites([])).resolves.toBeUndefined();
    });
  });
});
