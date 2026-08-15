import { Types } from 'mongoose';

import { MESSAGES_COLLECTION } from '@/messaging/cores/models/message.model';
import { MessageRepository } from '@/messaging/cores/repositories/message.repository';
import { ConnectionSingleton } from '@/shared/infra/database/connection.singleton';
import { TestHelper } from '@/shared/test/test-helper';
import { MessageFactory } from '@/messaging/test/factories/message.factory';

/**
 * `autoIndex` is off everywhere, so an index exists only if a migration created
 * it. These tests are what stop that arrangement from failing silently: without
 * them a forgotten migration would leave the listing query doing a collection
 * scan, and nothing else would notice until production slowed down.
 *
 * Every assertion goes through `repository.collectionName` rather than a literal.
 * An earlier version hardcoded 'messages' while typegoose was actually writing to
 * 'messagemodels', so the explain ran against a different — empty, but correctly
 * indexed — collection and passed while production did full scans. Deriving the
 * name from the repository is what makes that impossible to repeat.
 */
describe('@cores/migrations — messaging indexes', () => {
  const testHelper = TestHelper.lightweightMode(MessageRepository);
  let repository: MessageRepository;

  beforeAll(async () => {
    await testHelper.beforeAll();
    repository = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => testHelper.setTenant('tenant-a'));

  describe('when the migrations have run', () => {
    it('should not let typegoose fall back to its derived collection name', () => {
      // Guards the pinning itself: drop @modelOptions from MessageModel and the
      // collection silently becomes the pluralised class name, which is the bug
      // that made an earlier version of this whole file pass vacuously.
      // Drift between the constant and the migration is caught by the index
      // assertions below, which look in the collection the repository uses.
      expect(repository.collectionName).toBe(MESSAGES_COLLECTION);
      expect(repository.collectionName).not.toBe('messagemodels');
    });

    it('should have created the compound index the listing is built around', async () => {
      const indexes = await ConnectionSingleton.get()
        .collection(repository.collectionName)
        .indexes();

      const listing = indexes.find(
        (index) => index.name === 'tenant_conversation_timestamp_id',
      );

      expect(listing).toBeDefined();
      expect(listing!.key).toEqual({
        tenantId: 1,
        conversationId: 1,
        timestamp: -1,
        _id: -1,
      });
    });
  });

  describe('when the listing query runs against that index', () => {
    it('should be served by an index scan rather than a collection scan', async () => {
      const conversationId = new Types.ObjectId();
      await new MessageFactory().createMany(5, { conversationId });

      // Assert the documents really landed where we are about to explain.
      expect(
        await ConnectionSingleton.get()
          .collection(repository.collectionName)
          .countDocuments({ conversationId }),
      ).toBe(5);

      const explained = await ConnectionSingleton.get()
        .collection(repository.collectionName)
        .find({ tenantId: 'tenant-a', conversationId })
        .sort({ timestamp: -1, _id: -1 })
        .limit(3)
        .explain('queryPlanner');

      const winningPlan = JSON.stringify(
        explained.queryPlanner.winningPlan ?? explained.queryPlanner,
      );

      expect(winningPlan).toContain('IXSCAN');
      expect(winningPlan).toContain('tenant_conversation_timestamp_id');
    });

    it('should not need a blocking in-memory sort', async () => {
      const conversationId = new Types.ObjectId();
      await new MessageFactory().createMany(5, { conversationId });

      // Assert the documents really landed where we are about to explain.
      expect(
        await ConnectionSingleton.get()
          .collection(repository.collectionName)
          .countDocuments({ conversationId }),
      ).toBe(5);

      const explained = await ConnectionSingleton.get()
        .collection(repository.collectionName)
        .find({ tenantId: 'tenant-a', conversationId })
        .sort({ timestamp: -1, _id: -1 })
        .limit(3)
        .explain('queryPlanner');

      // A SORT stage would mean the sort key no longer matches the index order,
      // which is the whole reason the index carries the direction it does.
      expect(
        JSON.stringify(
          explained.queryPlanner.winningPlan ?? explained.queryPlanner,
        ),
      ).not.toContain('SORT');
    });
  });

  describe('when the repository issues the same query', () => {
    it('should stay in step with the index it was designed for', async () => {
      const conversationId = new Types.ObjectId();
      await new MessageFactory().createMany(3, { conversationId });

      const page = await repository.pageByConversation({
        conversationId: conversationId.toString(),
        limit: 2,
      });

      expect(page).toHaveLength(2);
    });
  });
});
