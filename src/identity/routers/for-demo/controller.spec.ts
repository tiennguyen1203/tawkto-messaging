import { TenantCreatedEvent } from '@/identity/infra/kafka/tenant-created.event';
import { TenantEventsPublisher } from '@/identity/infra/kafka/tenant-events.publisher';
import { TestHelper } from '@/shared/test/test-helper';
import { ForDemoController } from './controller';

/**
 * Stands in for the real publisher, which would want a broker.
 *
 * Recording the calls rather than discarding them is the point: publishing the
 * tenant event is a promise this context makes to another one, and a promise no
 * test checks is a promise that quietly stops being kept.
 */
class RecordingTenantEventsPublisher {
  static published: TenantCreatedEvent[] = [];

  tenantCreated(event: TenantCreatedEvent): Promise<void> {
    RecordingTenantEventsPublisher.published.push(event);
    return Promise.resolve();
  }
}

describe('@identity/routers/for-demo/controller', () => {
  const testHelper = TestHelper.lightweightMode(ForDemoController).mock(
    TenantEventsPublisher,
    RecordingTenantEventsPublisher,
  );

  beforeAll(() => testHelper.beforeAll(), 120_000);
  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  beforeEach(() => {
    RecordingTenantEventsPublisher.published = [];
  });

  const createTenant = async (name = 'Acme Corp'): Promise<string> => {
    const res = await testHelper.request
      .post('/api/v1/for-demo/tenants')
      .send({ name })
      .expect(201);
    return res.body.data.id as string;
  };

  const createUser = async (
    tenantId: string,
    email = 'alice@acme.test',
    roles: string[] = ['user'],
  ) => {
    const res = await testHelper.request
      .post('/api/v1/for-demo/users')
      .send({ tenantId, email, displayName: 'Alice', roles })
      .expect(201);
    return res.body.data;
  };

  describe('#POST /for-demo/tenants', () => {
    describe('when a name is given', () => {
      it('should answer 201 with the created tenant', async () => {
        const res = await testHelper.request
          .post('/api/v1/for-demo/tenants')
          .send({ name: 'Acme Corp' })
          .expect(201);

        expect(res.body.data).toMatchObject({ name: 'Acme Corp' });
        expect(res.body.data.id).toEqual(expect.any(String));
      });
    });

    describe('when a tenant is created', () => {
      it('should announce it, so another context can provision against it', async () => {
        // Messaging turns this into the tenant's search alias. Losing it is
        // survivable — the alias is also created lazily — but silently stopping
        // publishing would move that recovery path back to being the design.
        const res = await testHelper.request
          .post('/api/v1/for-demo/tenants')
          .send({ name: 'Announced Co' })
          .expect(201);

        expect(RecordingTenantEventsPublisher.published).toEqual([
          {
            tenantId: res.body.data.id,
            name: 'Announced Co',
            createdAt: expect.any(Number),
          },
        ]);
      });
    });

    describe('when the name is blank', () => {
      it('should answer 400', async () => {
        await testHelper.request
          .post('/api/v1/for-demo/tenants')
          .send({ name: '   ' })
          .expect(400);

        // Nothing was stored, so nothing may have been announced.
        expect(RecordingTenantEventsPublisher.published).toEqual([]);
      });
    });

    describe('when no token is supplied', () => {
      it('should still answer 201, because a token comes from here', async () => {
        // The route is public by necessity rather than by oversight: requiring a
        // token to obtain the first token is a closed loop. What keeps that from
        // being a hole is the environment guard, covered below.
        await testHelper.request
          .post('/api/v1/for-demo/tenants')
          .send({ name: 'No Token Needed' })
          .expect(201);
      });
    });
  });

  describe('#GET /for-demo/tenants', () => {
    describe('when tenants exist', () => {
      it('should list all of them, because nothing else enumerates tenants', async () => {
        // The picker cannot ask for a tenant's users until it can offer a tenant,
        // and this is the only route in either service that will say what tenants
        // there are.
        await createTenant('First');
        await createTenant('Second');

        const res = await testHelper.request
          .get('/api/v1/for-demo/tenants')
          .expect(200);

        // Compared as a set: the query sorts by createdAt, and two tenants created
        // in the same millisecond have no defined order between them. Asserting a
        // sequence here would fail on a fast machine and pass on a slow one.
        expect(
          res.body.data.items.map((t: { name: string }) => t.name).sort(),
        ).toEqual(['First', 'Second']);
      });

      it('should give each one the id the users endpoint takes', async () => {
        const created = await createTenant('Acme Corp');

        const res = await testHelper.request
          .get('/api/v1/for-demo/tenants')
          .expect(200);

        expect(res.body.data.items).toEqual([
          {
            id: created,
            name: 'Acme Corp',
            createdAt: expect.any(String),
          },
        ]);
      });
    });

    describe('when there are no tenants', () => {
      it('should answer 200 with an empty list rather than 404', async () => {
        // An empty demo is a normal state, not a missing resource — the picker
        // renders "nothing here yet" from this, and a 404 would read as a broken
        // endpoint instead.
        const res = await testHelper.request
          .get('/api/v1/for-demo/tenants')
          .expect(200);

        expect(res.body.data.items).toEqual([]);
      });
    });
  });

  describe('#POST /for-demo/users', () => {
    describe('when the tenant exists', () => {
      it('should answer 201 with the user in that tenant', async () => {
        const tenantId = await createTenant();

        const user = await createUser(tenantId);

        expect(user).toMatchObject({
          tenantId,
          email: 'alice@acme.test',
          displayName: 'Alice',
          roles: ['user'],
        });
      });
    });

    describe('when the tenant does not exist', () => {
      it('should answer 404 rather than creating an unreachable user', async () => {
        // A user in a tenant that does not exist would still be issued a token,
        // and messaging would accept it — it only checks the signature.
        await testHelper.request
          .post('/api/v1/for-demo/users')
          .send({
            tenantId: '6a7f352caefeeac0e37bd99c',
            email: 'ghost@acme.test',
            displayName: 'Ghost',
          })
          .expect(404);
      });
    });

    describe('when the email is already used in that tenant', () => {
      it('should answer 409', async () => {
        const tenantId = await createTenant();
        await createUser(tenantId);

        await testHelper.request
          .post('/api/v1/for-demo/users')
          .send({
            tenantId,
            email: 'alice@acme.test',
            displayName: 'Alice Again',
          })
          .expect(409);
      });
    });

    describe('when the same email is used in a different tenant', () => {
      it('should answer 201, because tenants do not share a namespace', async () => {
        const first = await createTenant('First');
        const second = await createTenant('Second');
        await createUser(first);

        await createUser(second);
      });
    });
  });

  describe('#GET /for-demo/users', () => {
    describe('when a tenant has users', () => {
      it('should list only that tenant users', async () => {
        const mine = await createTenant('Mine');
        const theirs = await createTenant('Theirs');
        await createUser(mine, 'alice@acme.test');
        await createUser(theirs, 'bob@other.test');

        const res = await testHelper.request
          .get('/api/v1/for-demo/users')
          .query({ tenantId: mine })
          .expect(200);

        expect(
          res.body.data.items.map((u: { email: string }) => u.email),
        ).toEqual(['alice@acme.test']);
      });
    });
  });

  describe('#POST /for-demo/tokens', () => {
    describe('when the user exists', () => {
      it('should answer 201 with a token carrying that user tenant and roles', async () => {
        const tenantId = await createTenant();
        const user = await createUser(tenantId, 'alice@acme.test', ['admin']);

        const res = await testHelper.request
          .post('/api/v1/for-demo/tokens')
          .send({ userId: user.id })
          .expect(201);

        const payload = JSON.parse(
          Buffer.from(
            (res.body.data.accessToken as string).split('.')[1],
            'base64url',
          ).toString(),
        ) as { sub: string; tenantId: string; roles: string[] };

        // The claims messaging reads. If these drift, every request it serves is
        // scoped to the wrong thing.
        expect(payload).toMatchObject({
          sub: user.id,
          tenantId,
          roles: ['admin'],
        });
      });
    });

    describe('when the user does not exist', () => {
      it('should answer 404 rather than signing a token for nobody', async () => {
        await testHelper.request
          .post('/api/v1/for-demo/tokens')
          .send({ userId: '6a7f352caefeeac0e37bd99c' })
          .expect(404);
      });
    });
  });

  describe('when the environment is not a local one', () => {
    it('should refuse every seeding route', async () => {
      // The path says what shape these endpoints are; this is what says who may
      // call them. Reachable in production they would be an open door to every
      // tenant's data, so the guard fails closed on an environment it does not
      // recognise.
      const original = process.env.APP_ENV;
      process.env.APP_ENV = 'prod';

      try {
        await testHelper.request
          .post('/api/v1/for-demo/tenants')
          .send({ name: 'Should Not Exist' })
          .expect(403);

        await testHelper.request
          .post('/api/v1/for-demo/tokens')
          .send({ userId: '6a7f352caefeeac0e37bd99c' })
          .expect(403);

        // The listing most worth refusing: it names every organisation in the
        // system, which no tenant's own user should ever be able to ask for.
        await testHelper.request.get('/api/v1/for-demo/tenants').expect(403);
      } finally {
        process.env.APP_ENV = original;
      }
    });
  });
});
