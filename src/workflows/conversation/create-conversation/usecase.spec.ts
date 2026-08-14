import { UseCaseErrorType } from '@/workflows/shared/base-use-case';
import { TestHelper } from '@/test/test-helper';
import { CreateConversationUseCase } from './usecase';

describe('@workflows/conversation/create-conversation', () => {
  const testHelper = TestHelper.lightweightMode(CreateConversationUseCase);
  let usecase: CreateConversationUseCase;

  beforeAll(async () => {
    await testHelper.beforeAll();
    usecase = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => {
    testHelper.setTenant('tenant-a');
  });

  describe('when a caller creates a conversation', () => {
    it('should file it under the tenant in context', async () => {
      const { data, error } = await usecase.execute({
        creatorId: 'alice',
        participantIds: ['alice', 'bob'],
      });

      expect(error).toBeNull();
      expect(data).toMatchObject({
        tenantId: 'tenant-a',
        participantIds: ['alice', 'bob'],
      });
      expect(data!.id).toEqual(expect.any(String));
    });
  });

  describe('when the creator left themselves out of the participants', () => {
    it('should add them, so they can post into what they created', async () => {
      const { data } = await usecase.execute({
        creatorId: 'alice',
        participantIds: ['bob'],
      });

      expect(data!.participantIds).toContain('alice');
    });
  });

  describe('when a participant is listed more than once', () => {
    it('should store them once, so membership is counted once', async () => {
      const { data } = await usecase.execute({
        creatorId: 'alice',
        // 'alice' arrives twice: once as creator, once in the list.
        participantIds: ['alice', 'bob', 'bob'],
      });

      expect(data!.participantIds).toEqual(['alice', 'bob']);
    });
  });

  // A conversation needs someone to talk to. The rule cannot live in the DTO:
  // the creator is merged in and duplicates collapsed afterwards, so only the
  // use case can see the final membership.
  describe('when the creator would be the only participant', () => {
    it('should reject a list naming only the creator', async () => {
      const { data, error } = await usecase.execute({
        creatorId: 'alice',
        participantIds: ['alice'],
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.INVALID_INPUT);
    });

    it('should reject an empty list, which collapses to the creator alone', async () => {
      const { data, error } = await usecase.execute({
        creatorId: 'alice',
        participantIds: [],
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.INVALID_INPUT);
    });

    it('should reject a list that is only the creator repeated', async () => {
      const { error } = await usecase.execute({
        creatorId: 'alice',
        participantIds: ['alice', 'alice'],
      });

      expect(error?.type).toBe(UseCaseErrorType.INVALID_INPUT);
    });

    it('should accept as soon as one other person is named', async () => {
      const { data, error } = await usecase.execute({
        creatorId: 'alice',
        participantIds: ['alice', 'bob'],
      });

      expect(error).toBeNull();
      expect(data!.participantIds).toEqual(['alice', 'bob']);
    });
  });
});
