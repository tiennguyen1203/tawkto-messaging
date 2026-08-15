import { Types } from 'mongoose';

import { MessageSearchIndex } from '@/messaging/infra/elasticsearch/message-search.index';
import { ConversationFactory } from '@/messaging/test/factories/conversation.factory';
import { SearchHelper } from '@/messaging/test/search-helper';
import { TestHelper } from '@/shared/test/test-helper';
import { UseCaseErrorType } from '@/shared/use-case/base-use-case';
import { SearchConversationMessagesUseCase } from './usecase';

describe('@workflows/message/search-conversation-messages', () => {
  const searchHelper = new SearchHelper('search-usecase-spec');
  const TENANT = searchHelper.tenant('a');
  const OTHER_TENANT = searchHelper.tenant('b');

  const testHelper = TestHelper.lightweightMode(
    SearchConversationMessagesUseCase,
  );
  let usecase: SearchConversationMessagesUseCase;
  let index: MessageSearchIndex;

  beforeAll(async () => {
    await searchHelper.setUp();
    index = new MessageSearchIndex(searchHelper.client);

    await testHelper.beforeAll();
    usecase = testHelper.unit;
  }, 180_000);

  afterAll(async () => {
    await searchHelper.tearDown();
    await testHelper.afterAll();
  });

  afterEach(async () => {
    await searchHelper.cleanUp();
    await testHelper.cleanUp();
  });

  beforeEach(() => {
    testHelper.setTenant(TENANT);
  });

  const seedConversation = (tenantId = TENANT) =>
    new ConversationFactory(tenantId).create({
      participantIds: ['alice', 'bob'],
    });

  const seedMessages = async (
    conversationId: string,
    contents: string[],
    tenantId = TENANT,
  ) => {
    await index.applyWrites(
      contents.map((content, i) => ({
        op: 'index' as const,
        document: {
          messageId: searchHelper.id(`${conversationId}-${i}`),
          tenantId,
          conversationId,
          senderId: 'alice',
          content,
          timestamp: 1_786_763_181_000 + i,
        },
      })),
    );
    await searchHelper.refresh();
  };

  describe('when a term matches messages in the conversation', () => {
    it('should return them in the shape the API speaks', async () => {
      const conversation = await seedConversation();
      const id = conversation._id.toString();
      await seedMessages(id, ['pangolin sighting', 'quokka sighting']);

      const { data, error } = await usecase.execute({
        conversationId: id,
        text: 'pangolin',
        limit: 10,
      });

      expect(error).toBeNull();
      expect(data!.items).toHaveLength(1);
      expect(data!.items[0]).toMatchObject({
        conversationId: id,
        senderId: 'alice',
        content: 'pangolin sighting',
      });
      // Epoch milliseconds in the index, a Date at the boundary — like every
      // other endpoint.
      expect(data!.items[0].timestamp).toBeInstanceOf(Date);
      expect(data!.total).toBe(1);
      expect(data!.hasMore).toBe(false);
      expect(data!.nextCursor).toBeNull();
    });
  });

  describe('when nothing matches', () => {
    it('should return an empty page rather than an error', async () => {
      const conversation = await seedConversation();
      const id = conversation._id.toString();
      await seedMessages(id, ['pangolin sighting']);

      const { data, error } = await usecase.execute({
        conversationId: id,
        text: 'aardvark',
        limit: 10,
      });

      expect(error).toBeNull();
      expect(data!.items).toEqual([]);
      expect(data!.total).toBe(0);
    });
  });

  describe('when another tenant has indexed the same conversation id', () => {
    it('should return only the caller tenant messages', async () => {
      // Nothing in the use case names a tenant any more — the repository supplies
      // it. This is the test that fails if it supplies the wrong one, or none:
      // the 404 case below would still pass, because it never reaches the index.
      const conversation = await seedConversation();
      const id = conversation._id.toString();

      await seedMessages(id, ['pangolin sighting, ours']);
      await seedMessages(id, ['pangolin sighting, theirs'], OTHER_TENANT);

      const { data } = await usecase.execute({
        conversationId: id,
        text: 'pangolin',
        limit: 10,
      });

      expect(data!.items.map((m) => m.content)).toEqual([
        'pangolin sighting, ours',
      ]);
    });
  });

  describe('when the conversation belongs to another tenant', () => {
    it('should answer not found, not an empty page', async () => {
      // The difference matters: an empty page says "nothing matched", which is a
      // statement about a conversation the caller has no business knowing exists.
      const conversation = await seedConversation(OTHER_TENANT);
      const id = conversation._id.toString();
      await seedMessages(id, ['pangolin sighting'], OTHER_TENANT);

      const { data, error } = await usecase.execute({
        conversationId: id,
        text: 'pangolin',
        limit: 10,
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
    });
  });

  describe('when the conversation does not exist at all', () => {
    it('should answer not found', async () => {
      const { error } = await usecase.execute({
        conversationId: new Types.ObjectId().toString(),
        text: 'pangolin',
        limit: 10,
      });

      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
    });
  });

  describe('when the tenant has indexed nothing', () => {
    it('should return an empty page for a conversation that exists', async () => {
      const conversation = await seedConversation();

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        text: 'pangolin',
        limit: 10,
      });

      expect(error).toBeNull();
      expect(data!.items).toEqual([]);
    });
  });
});
