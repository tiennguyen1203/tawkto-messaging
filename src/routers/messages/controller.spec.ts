import { Types } from 'mongoose';

import { MAX_MESSAGE_CONTENT_LENGTH } from '@/common/constants';
import { TestHelper } from '@/test/test-helper';
import { ConversationFactory } from '@/test/factories/conversation.factory';
import { MessagesController } from './controller';

describe('@routers/messages/controller', () => {
  const testHelper = TestHelper.lightweightMode(MessagesController);

  beforeAll(() => testHelper.beforeAll(), 120_000);
  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  const alice = () =>
    testHelper.fakeUser({ id: 'alice', tenantId: 'tenant-a' });

  describe('#POST /api/v1/messages', () => {
    describe('when a participant posts to their own conversation', () => {
      it('should answer 201 with the created message', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice', 'bob'],
        });

        const res = await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({ conversationId: conversation._id.toString(), content: 'hi' })
          .expect(201);

        expect(res.body.data).toMatchObject({
          conversationId: conversation._id.toString(),
          senderId: 'alice',
          content: 'hi',
        });
      });
    });

    describe('when the body claims a different senderId and timestamp', () => {
      it('should ignore both, taking the sender from the token and the clock from the server', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice', 'bob'],
        });

        const res = await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({
            conversationId: conversation._id.toString(),
            content: 'hi',
            senderId: 'bob',
            timestamp: '1999-01-01T00:00:00.000Z',
          })
          .expect(201);

        expect(res.body.data.senderId).toBe('alice');
        expect(new Date(res.body.data.timestamp).getFullYear()).toBeGreaterThan(
          2020,
        );
      });
    });

    describe('when the request carries no token', () => {
      it('should answer 401', async () => {
        await testHelper.request
          .post('/api/v1/messages')
          .send({
            conversationId: new Types.ObjectId().toString(),
            content: 'hi',
          })
          .expect(401);
      });
    });

    describe('when the conversation belongs to another tenant', () => {
      it('should answer 404', async () => {
        const theirs = await new ConversationFactory('tenant-b').create({
          participantIds: ['alice'],
        });

        await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({ conversationId: theirs._id.toString(), content: 'probing' })
          .expect(404);
      });
    });

    describe('when the sender is not a participant', () => {
      it('should answer 403', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['bob'],
        });

        await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({ conversationId: conversation._id.toString(), content: 'hi' })
          .expect(403);
      });
    });

    describe('when the body is malformed', () => {
      it('should answer 400', async () => {
        await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({ conversationId: 'not-an-id', content: '' })
          .expect(400);
      });
    });

    // Content shape is validated by the DTO, so it is asserted here at the edge
    // rather than in the use-case spec — see D27.
    describe('when the content is blank or only whitespace', () => {
      it('should answer 400 for both', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice'],
        });

        for (const content of ['', '   ', '\n\t ']) {
          await testHelper.request
            .post('/api/v1/messages')
            .requestedBy(alice())
            .send({ conversationId: conversation._id.toString(), content })
            .expect(400);
        }
      });
    });

    describe('when the content carries surrounding whitespace', () => {
      it('should accept it and store it trimmed', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice'],
        });

        const res = await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({
            conversationId: conversation._id.toString(),
            content: '  hello  ',
          })
          .expect(201);

        expect(res.body.data.content).toBe('hello');
      });
    });

    describe('when the content exceeds the maximum length', () => {
      it('should answer 400', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice'],
        });

        await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({
            conversationId: conversation._id.toString(),
            content: 'a'.repeat(MAX_MESSAGE_CONTENT_LENGTH + 1),
          })
          .expect(400);
      });

      it('should accept content sitting exactly on the limit', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice'],
        });

        await testHelper.request
          .post('/api/v1/messages')
          .requestedBy(alice())
          .send({
            conversationId: conversation._id.toString(),
            content: 'a'.repeat(MAX_MESSAGE_CONTENT_LENGTH),
          })
          .expect(201);
      });
    });
  });

  describe('#GET /api/v1/conversations/:conversationId/messages', () => {
    describe('when the conversation is empty', () => {
      it('should answer 200 with an empty cursor page', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice'],
        });

        const res = await testHelper.request
          .get(`/api/v1/conversations/${conversation._id.toString()}/messages`)
          .requestedBy(alice())
          .expect(200);

        expect(res.body.data).toEqual({
          items: [],
          nextCursor: null,
          hasMore: false,
        });
      });
    });

    describe('when the requested limit exceeds the maximum', () => {
      it('should answer 400 rather than silently serving a different size', async () => {
        const conversation = await new ConversationFactory().create({
          participantIds: ['alice'],
        });

        await testHelper.request
          .get(`/api/v1/conversations/${conversation._id.toString()}/messages`)
          .query({ limit: 10_000 })
          .requestedBy(alice())
          .expect(400);
      });
    });
  });
});
