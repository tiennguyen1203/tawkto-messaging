import { Types } from 'mongoose';

import { ConversationFactory } from '@/test/factories/conversation.factory';
import { TestHelper } from '@/test/test-helper';
import { ConversationRepository } from './conversation.repository';

describe('@cores/repositories/conversation.repository', () => {
  const testHelper = TestHelper.lightweightMode(ConversationRepository);
  let repository: ConversationRepository;

  beforeAll(async () => {
    await testHelper.beforeAll();
    repository = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => {
    testHelper.setTenant('tenant-a');
  });

  const seed = (tenantId = 'tenant-a') =>
    new ConversationFactory(tenantId).create({
      participantIds: ['alice', 'bob'],
    });

  describe('#findCachedSummaryInTenant', () => {
    describe('when the conversation exists in this tenant', () => {
      it('should return what a caller needs to authorise a message', async () => {
        const conversation = await seed();

        const summary = await repository.findCachedSummaryInTenant(
          conversation._id.toString(),
        );

        expect(summary).toEqual({
          id: conversation._id.toString(),
          participantIds: ['alice', 'bob'],
        });
      });

      it('should return the id as a string, not an ObjectId', async () => {
        // The value round-trips through Redis as JSON in production, so anything
        // that is an ObjectId here would come back a string there — and the
        // in-memory store the tests use would never show it.
        const conversation = await seed();

        const summary = await repository.findCachedSummaryInTenant(
          conversation._id.toString(),
        );

        expect(typeof summary!.id).toBe('string');
        expect(summary!.id).not.toBeInstanceOf(Types.ObjectId);
      });
    });

    describe('when the same conversation is asked for twice', () => {
      it('should answer the second time without reading the database', async () => {
        const conversation = await seed();
        const id = conversation._id.toString();

        await repository.findCachedSummaryInTenant(id);

        // Deleting the document out from under the cache is what makes this a
        // test of the cache rather than of the query: a second read that still
        // answers cannot have come from MongoDB.
        await repository.deleteOne({ _id: conversation._id });
        expect(await repository.findByIdInTenant(id)).toBeNull();

        expect(await repository.findCachedSummaryInTenant(id)).toMatchObject({
          id,
        });
      });
    });

    describe('when another tenant asks for the same conversation id', () => {
      it('should not see the first tenant cached entry', async () => {
        // The single most important property here. A cache key that omitted the
        // tenant would hand tenant-b a conversation it must not know exists —
        // and every other test in this file would still pass.
        const conversation = await seed('tenant-a');
        const id = conversation._id.toString();

        expect(await repository.findCachedSummaryInTenant(id)).not.toBeNull();

        testHelper.setTenant('tenant-b');

        expect(await repository.findCachedSummaryInTenant(id)).toBeNull();
      });
    });

    describe('when the conversation does not exist', () => {
      it('should not cache the miss, so a later creation is visible at once', async () => {
        const id = new Types.ObjectId();

        expect(
          await repository.findCachedSummaryInTenant(id.toString()),
        ).toBeNull();

        await new ConversationFactory('tenant-a').create({
          _id: id,
          participantIds: ['alice'],
        });

        expect(
          await repository.findCachedSummaryInTenant(id.toString()),
        ).toMatchObject({ id: id.toString() });
      });
    });

    describe('when the id is not a valid ObjectId', () => {
      it('should answer not found without touching the cache or the database', async () => {
        expect(
          await repository.findCachedSummaryInTenant('not-an-id'),
        ).toBeNull();
      });
    });
  });
});
