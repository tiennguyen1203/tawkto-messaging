import { TerminusModule } from '@nestjs/terminus';
import { TestHelper } from '@/test/test-helper';
import { HealthController } from './health-check.controller';

describe('@routers/health-check/controller', () => {
  // Terminus configures its own indicators, so the module is imported rather
  // than letting the scanner construct them bare.
  const testHelper =
    TestHelper.lightweightMode(HealthController).imports(TerminusModule);

  beforeAll(() => testHelper.beforeAll(), 120_000);
  afterAll(() => testHelper.afterAll());

  describe('#GET /api/health', () => {
    describe('when the request carries no token', () => {
      it('should still answer, because the route is public', async () => {
        const res = await testHelper.request.get('/api/health');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('ok');
      });
    });

    describe('when the dependencies are reachable', () => {
      it('should report mongodb and redis as up', async () => {
        const res = await testHelper.request.get('/api/health');

        expect(res.body.data.details).toMatchObject({
          mongodb: { status: 'up' },
          redis: { status: 'up' },
        });
      });
    });
  });
});
