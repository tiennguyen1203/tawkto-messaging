import { TestHelper } from '@/test/test-helper';

/**
 * Boots the entire AppModule against a real MongoDB. This is the spec that
 * catches wiring mistakes the lightweight modes cannot see — a module missing
 * from commonModules, a provider that cannot be constructed, a token that
 * resolves in tests but not in the real container.
 */
describe('App smoke test', () => {
  const testHelper = TestHelper.fullAppMode();

  beforeAll(async () => {
    await testHelper.beforeAll();
  }, 120_000);

  afterAll(() => testHelper.afterAll());

  describe('when the whole application module is loaded', () => {
    it('should boot', () => {
      expect(testHelper.request).toBeDefined();
    });

    it('should serve the health check', async () => {
      const res = await testHelper.request.get('/api/health');

      expect([200, 503]).toContain(res.status);
    });
  });

  describe('when an unauthenticated request hits a non-public route', () => {
    it('should be stopped by the guard chain rather than erroring out', async () => {
      const res = await testHelper.request.get('/api/v1/does-not-exist');

      // 401 from the global guard, or 404 once past it.
      expect([401, 404]).toContain(res.status);
    });
  });
});
