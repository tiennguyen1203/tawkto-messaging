import { Types } from 'mongoose';

import { MessageRepository } from '@/messaging/cores/repositories/message.repository';
import { TestHelper } from '@/shared/test/test-helper';
import { ConversationFactory } from '@/messaging/test/factories/conversation.factory';
import { UseCaseErrorType } from '@/shared/use-case/base-use-case';
import { CreateMessageUseCase } from './usecase';

describe('@workflows/message/create-message', () => {
  const testHelper = TestHelper.lightweightMode(CreateMessageUseCase);
  let usecase: CreateMessageUseCase;
  let messageRepository: MessageRepository;

  beforeAll(async () => {
    await testHelper.beforeAll();
    usecase = testHelper.unit;
    messageRepository = testHelper.get(MessageRepository);
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => {
    testHelper.setTenant('tenant-a');
  });

  describe('when a participant posts to a conversation in their tenant', () => {
    it('should store the message', async () => {
      const conversation = await new ConversationFactory().create({
        participantIds: ['alice', 'bob'],
      });

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        senderId: 'alice',
        content: 'hello world',
      });

      expect(error).toBeNull();
      expect(data).toMatchObject({
        conversationId: conversation._id.toString(),
        senderId: 'alice',
        content: 'hello world',
      });
      expect(data!.id).toEqual(expect.any(String));
    });

    it('should assign the timestamp from the server clock', async () => {
      const conversation = await new ConversationFactory().create({
        participantIds: ['alice'],
      });
      const before = Date.now();

      const { data } = await usecase.execute({
        conversationId: conversation._id.toString(),
        senderId: 'alice',
        content: 'now',
      });

      expect(data!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(data!.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should persist metadata verbatim, including nested structures', async () => {
      const conversation = await new ConversationFactory().create({
        participantIds: ['alice'],
      });
      const metadata = { clientId: 'ios-3.1', attachments: [{ id: 'a1' }] };

      const { data } = await usecase.execute({
        conversationId: conversation._id.toString(),
        senderId: 'alice',
        content: 'see attached',
        metadata,
      });

      const stored = await messageRepository.findById(data!.id);
      expect(stored!.metadata).toEqual(metadata);
    });

    it('should leave metadata unset when none was supplied', async () => {
      const conversation = await new ConversationFactory().create({
        participantIds: ['alice'],
      });

      const { data } = await usecase.execute({
        conversationId: conversation._id.toString(),
        senderId: 'alice',
        content: 'no attachments',
      });

      // Not null and not an empty object — an absent field stays absent, so the
      // Elasticsearch mapping in M3 never sees a spurious empty value.
      const stored = await messageRepository.findById(data!.id);
      expect(stored!.metadata).toBeUndefined();
    });
  });

  describe('when the conversation belongs to another tenant', () => {
    it('should report it as not found rather than forbidden', async () => {
      const theirs = await new ConversationFactory('tenant-b').create({
        participantIds: ['alice', 'bob'],
      });

      const { data, error } = await usecase.execute({
        conversationId: theirs._id.toString(),
        senderId: 'alice',
        content: 'probing',
      });

      expect(data).toBeNull();
      // A 403 here would confirm the conversation exists.
      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
    });

    it('should write nothing into the other tenant', async () => {
      const theirs = await new ConversationFactory('tenant-b').create({
        participantIds: ['alice'],
      });

      await usecase.execute({
        conversationId: theirs._id.toString(),
        senderId: 'alice',
        content: 'probing',
      });

      expect(await messageRepository.forTenant('tenant-b').count()).toBe(0);
    });
  });

  describe('when the conversation does not exist', () => {
    it('should report it as not found', async () => {
      const { data, error } = await usecase.execute({
        conversationId: new Types.ObjectId().toString(),
        senderId: 'alice',
        content: 'hello',
      });

      expect(data).toBeNull();
      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
    });
  });

  describe('when the conversation id is malformed', () => {
    it('should report it as not found rather than crashing', async () => {
      const { error } = await usecase.execute({
        conversationId: 'not-an-object-id',
        senderId: 'alice',
        content: 'hello',
      });

      expect(error?.type).toBe(UseCaseErrorType.NOT_FOUND);
    });
  });

  describe('when the sender is not a participant', () => {
    it('should refuse with permission denied', async () => {
      const conversation = await new ConversationFactory().create({
        participantIds: ['alice', 'bob'],
      });

      const { data, error } = await usecase.execute({
        conversationId: conversation._id.toString(),
        senderId: 'mallory',
        content: 'let me in',
      });

      expect(data).toBeNull();
      // The conversation is known to exist within this tenant, so 403 leaks
      // nothing the caller could not already see.
      expect(error?.type).toBe(UseCaseErrorType.PERMISSION_DENIED);
    });

    it('should write nothing', async () => {
      const conversation = await new ConversationFactory().create({
        participantIds: ['alice'],
      });

      await usecase.execute({
        conversationId: conversation._id.toString(),
        senderId: 'mallory',
        content: 'let me in',
      });

      expect(await messageRepository.count()).toBe(0);
    });
  });
});
