import { Types } from 'mongoose';

import { MessageRepository } from '@/cores/repositories/message.repository';
import { ConnectionSingleton } from '@/infra/database/connection.singleton';
import { TestHelper } from '@/test/test-helper';
import { MessageFactory } from '@/test/factories/message.factory';

/**
 * `autoIndex` is off everywhere, so an index exists only if a migration created
 * it. These tests are what stop that arrangement from failing silently: without
 * them a forgotten migration would leave the listing query doing a collection
 * scan, and nothing else would notice until production slowed down.
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
    it('should have created the compound index the listing is built around', async () => {
      const indexes = await ConnectionSingleton.get()
        .collection('messages')
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

      const explained = await ConnectionSingleton.get()
        .collection('messages')
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

      const explained = await ConnectionSingleton.get()
        .collection('messages')
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
