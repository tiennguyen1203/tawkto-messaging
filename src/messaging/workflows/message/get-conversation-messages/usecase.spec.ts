import { Types } from 'mongoose';

import { TestHelper } from '@/shared/test/test-helper';
import { ConversationFactory } from '@/messaging/test/factories/conversation.factory';
import { MessageFactory } from '@/messaging/test/factories/message.factory';
import { UseCaseErrorType } from '@/shared/use-case/base-use-case';
import { GetConversationMessagesUseCase } from './usecase';

describe('@workflows/message/get-conversation-messages', () => {
  const testHelper = TestHelper.lightweightMode(GetConversationMessagesUseCase);
  let usecase: GetConversationMessagesUseCase;

  beforeAll(async () => {
    await testHelper.beforeAll();
    usecase = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => {
    testHelper.setTenant('tenant-a');
  });

  const seedConversation = async (tenantId = 'tenant-a') =>
    new ConversationFactory(tenantId).create({
      participantIds: ['alice', 'bob'],
    });

  /** Seeds `count` messages one second apart, oldest first. */
  const seedMessages = async (
    conversationId: Types.ObjectId,
    count: number,
    tenantId = 'tenant-a',
  ) => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const factory = new MessageFactory(tenantId);

    for (let i = 0; i < count; i += 1) {
      await factory.create({
        conversationId,
        content: `message-${i}`,
        timestamp: new Date(base + i * 1000),
      });
    }
  };

  /** Walks every page, returning the contents in the order they were served. */
  const drain = async (conversationId: string, limit: number) => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const { data } = await usecase.execute({
        conversationId,
        requesterId: 'alice',
        limit,
        cursor,
      });
      seen.push(...data!.items.map((m) => m.content));
      cursor = data!.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 50);

    return { seen, pages };
  };

  describe('when the conversation holds fewer messages than the limit', () => {
    it('should return them newest first', async () => {
      const conversation = await seedConversation();
      await seedMessages(conversation._id, 3);

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'alice',
        limit: 10,
      });

      expect(error).toBeNull();
      expect(data!.items.map((m) => m.content)).toEqual([
        'message-2',
        'message-1',
        'message-0',
      ]);
    });

    it('should report no further page', async () => {
      const conversation = await seedConversation();
      await seedMessages(conversation._id, 4);

      const { data } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'alice',
        limit: 4,
      });

      expect(data!.hasMore).toBe(false);
      expect(data!.nextCursor).toBeNull();
    });
  });

  describe('when paging through more messages than fit on one page', () => {
    it('should serve every message exactly once, with no gaps or repeats', async () => {
      const conversation = await seedConversation();
      await seedMessages(conversation._id, 10);

      const { seen, pages } = await drain(conversation._id.toString(), 3);

      expect(seen).toEqual([
        'message-9',
        'message-8',
        'message-7',
        'message-6',
        'message-5',
        'message-4',
        'message-3',
        'message-2',
        'message-1',
        'message-0',
      ]);
      expect(new Set(seen).size).toBe(10);
      expect(pages).toBe(4);
    });
  });

  describe('when several messages share the same timestamp', () => {
    it('should still serve each exactly once across the page break', async () => {
      const conversation = await seedConversation();
      const sameInstant = new Date('2026-01-01T00:00:00.000Z');
      const factory = new MessageFactory();

      for (let i = 0; i < 6; i += 1) {
        await factory.create({
          conversationId: conversation._id,
          content: `tie-${i}`,
          timestamp: sameInstant,
        });
      }

      const { seen } = await drain(conversation._id.toString(), 2);

      // Without the _id tiebreaker in both the sort and the cursor comparison,
      // documents sharing a timestamp are skipped or served twice.
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
    });
  });

  describe('when another tenant holds messages under the same conversation id', () => {
    it("should return only this tenant's messages", async () => {
      const conversation = await seedConversation();
      await seedMessages(conversation._id, 3, 'tenant-b');
      await seedMessages(conversation._id, 2, 'tenant-a');

      const { data } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'alice',
        limit: 50,
      });

      expect(data!.items).toHaveLength(2);
    });
  });

  describe('when the reader is in the tenant but not in the conversation', () => {
    it('should refuse, rather than serving somebody else conversation', async () => {
      // This was a real hole, found by pointing a browser at it: the read path
      // checked the tenant and stopped there, so anyone holding any token for the
      // tenant could read every conversation in it by id. The write path had
      // always checked membership; the two now agree.
      const conversation = await seedConversation();
      await seedMessages(conversation._id, 1);

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'carol',
        limit: 10,
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.PERMISSION_DENIED);
    });

    it('should refuse rather than answer an empty page', async () => {
      // An empty page would be the tempting fix — filter the rows and return
      // nothing. It says "this conversation exists in your tenant and has no
      // messages", which is both a leak and a lie.
      const conversation = await seedConversation();

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'carol',
        limit: 10,
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.PERMISSION_DENIED);
    });
  });

  describe('when the conversation belongs to another tenant', () => {
    it('should report it as not found', async () => {
      const theirs = await seedConversation('tenant-b');

      const { data, error } = await usecase.execute({
        conversationId: theirs._id.toString(),
        requesterId: 'alice',
        limit: 10,
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
    });
  });

  describe('when the conversation has no messages', () => {
    it('should return an empty page rather than an error', async () => {
      const conversation = await seedConversation();

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'alice',
        limit: 10,
      });

      expect(error).toBeNull();
      expect(data!.items).toEqual([]);
      expect(data!.hasMore).toBe(false);
    });
  });

  describe('when the cursor is unreadable', () => {
    it('should fall back to the first page rather than failing', async () => {
      const conversation = await seedConversation();
      await seedMessages(conversation._id, 2);

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        requesterId: 'alice',
        limit: 10,
        cursor: 'not-a-real-cursor',
      });

      expect(error).toBeNull();
      expect(data!.items).toHaveLength(2);
    });
  });
});
