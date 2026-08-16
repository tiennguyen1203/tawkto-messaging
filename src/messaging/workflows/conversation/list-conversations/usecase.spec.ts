import { TestHelper } from '@/shared/test/test-helper';
import { ConversationFactory } from '@/messaging/test/factories/conversation.factory';
import { ListConversationsUseCase } from './usecase';

describe('@workflows/conversation/list-conversations', () => {
  const testHelper = TestHelper.lightweightMode(ListConversationsUseCase);
  let usecase: ListConversationsUseCase;

  beforeAll(async () => {
    await testHelper.beforeAll();
    usecase = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => {
    testHelper.setTenant('tenant-a');
  });

  /** Conversations one second apart, so the descending order is unambiguous. */
  const seed = async (
    participants: string[][],
    tenantId = 'tenant-a',
  ): Promise<string[]> => {
    const factory = new ConversationFactory(tenantId);
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const ids: string[] = [];

    for (const [index, participantIds] of participants.entries()) {
      const conversation = await factory.create({
        participantIds,
        createdAt: new Date(base + index * 1000),
      });
      ids.push(conversation._id.toString());
    }

    return ids;
  };

  describe('when the caller is in some of the tenant conversations', () => {
    it('should list only those, not every conversation in the tenant', async () => {
      // The whole point of the endpoint, and the thing that would make it a leak
      // if it were wrong: the tenant says what exists, participation says what is
      // yours. Anything else hands out ids the message endpoints then refuse.
      const [withBob, theirs, withCarol] = await seed([
        ['alice', 'bob'],
        ['carol', 'dave'],
        ['alice', 'carol'],
      ]);

      const { data } = await usecase.execute({
        participantId: 'alice',
        limit: 10,
      });

      // Both of hers, newest first, and not the one she is not in. Asserted as the
      // whole list rather than as three separate claims: "contains mine" and "does
      // not contain theirs" would both pass on an endpoint that returned nothing.
      expect(data!.items.map((item) => item.id)).toEqual([withCarol, withBob]);
      expect(data!.items.map((item) => item.id)).not.toContain(theirs);
    });

    it('should put the newest first', async () => {
      const ids = await seed([
        ['alice', 'bob'],
        ['alice', 'carol'],
        ['alice', 'dave'],
      ]);

      const { data } = await usecase.execute({
        participantId: 'alice',
        limit: 10,
      });

      expect(data!.items.map((item) => item.id)).toEqual([...ids].reverse());
    });
  });

  describe('when another tenant has conversations with the same participant', () => {
    it('should not return them', async () => {
      // `alice` is an opaque id and nothing stops the same string existing in two
      // tenants. The repository is tenant-scoped by construction; this is the test
      // that says so out loud.
      await seed([['alice', 'bob']], 'tenant-b');

      const { data } = await usecase.execute({
        participantId: 'alice',
        limit: 10,
      });

      expect(data!.items).toEqual([]);
    });
  });

  describe('when there are more than one page', () => {
    it('should walk every conversation exactly once', async () => {
      const ids = await seed([
        ['alice', 'a'],
        ['alice', 'b'],
        ['alice', 'c'],
        ['alice', 'd'],
        ['alice', 'e'],
      ]);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const { data } = await usecase.execute({
          participantId: 'alice',
          limit: 2,
          cursor,
        });
        seen.push(...data!.items.map((item) => item.id));
        cursor = data!.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 20);

      expect(seen).toEqual([...ids].reverse());
      expect(new Set(seen).size).toBe(ids.length);
    });

    it('should stop saying there is more when there is not', async () => {
      await seed([
        ['alice', 'a'],
        ['alice', 'b'],
      ]);

      const { data } = await usecase.execute({
        participantId: 'alice',
        limit: 2,
      });

      expect(data!.hasMore).toBe(false);
      expect(data!.nextCursor).toBeNull();
    });
  });

  describe('when the caller is in nothing', () => {
    it('should answer an empty page rather than failing', async () => {
      await seed([['bob', 'carol']]);

      const { data, error } = await usecase.execute({
        participantId: 'alice',
        limit: 10,
      });

      expect(error).toBeNull();
      expect(data!.items).toEqual([]);
    });
  });
});
