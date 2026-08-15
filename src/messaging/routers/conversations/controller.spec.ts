import { TestHelper } from '@/shared/test/test-helper';
import { ConversationsController } from './controller';

describe('@routers/conversations/controller', () => {
  const testHelper = TestHelper.lightweightMode(ConversationsController);

  beforeAll(() => testHelper.beforeAll(), 120_000);
  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  const alice = () =>
    testHelper.fakeUser({ id: 'alice', tenantId: 'tenant-a' });

  describe('#POST /api/v1/conversations', () => {
    describe('when an authenticated caller supplies participants', () => {
      it("should create it under the caller's tenant, with the caller included", async () => {
        const res = await testHelper.request
          .post('/api/v1/conversations')
          .requestedBy(alice())
          .send({ participantIds: ['bob'] })
          .expect(201);

        expect(res.body.data).toMatchObject({
          tenantId: 'tenant-a',
          participantIds: ['alice', 'bob'],
        });
      });
    });

    describe('when the body carries a tenantId', () => {
      it('should ignore it and use the tenant from the token', async () => {
        const res = await testHelper.request
          .post('/api/v1/conversations')
          .requestedBy(alice())
          .send({ participantIds: ['bob'], tenantId: 'tenant-b' })
          .expect(201);

        expect(res.body.data.tenantId).toBe('tenant-a');
      });
    });

    describe('when the request carries no token', () => {
      it('should answer 401', async () => {
        await testHelper.request
          .post('/api/v1/conversations')
          .send({ participantIds: ['bob'] })
          .expect(401);
      });
    });

    // These two used to be indistinguishable: both answered 201 with a
    // conversation containing only the caller. See D29.
    describe('when participantIds is an empty list', () => {
      it('should answer 400 rather than quietly creating a solo conversation', async () => {
        await testHelper.request
          .post('/api/v1/conversations')
          .requestedBy(alice())
          .send({ participantIds: [] })
          .expect(400);
      });
    });

    describe('when participantIds names only the caller', () => {
      it('should answer 400, since a conversation needs someone to talk to', async () => {
        await testHelper.request
          .post('/api/v1/conversations')
          .requestedBy(alice())
          .send({ participantIds: ['alice'] })
          .expect(400);
      });
    });

    describe('when participantIds is missing or not a list of strings', () => {
      it('should answer 400', async () => {
        await testHelper.request
          .post('/api/v1/conversations')
          .requestedBy(alice())
          .send({})
          .expect(400);

        await testHelper.request
          .post('/api/v1/conversations')
          .requestedBy(alice())
          .send({ participantIds: [42] })
          .expect(400);
      });
    });
  });
});
