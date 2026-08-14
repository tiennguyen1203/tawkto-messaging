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
    it('is reachable without a token and reports healthy', async () => {
      const res = await testHelper.request.get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    });

    it('checks both mongodb and redis', async () => {
      const res = await testHelper.request.get('/api/health');

      expect(res.body.data.details).toMatchObject({
        mongodb: { status: 'up' },
        redis: { status: 'up' },
      });
    });
  });
});
