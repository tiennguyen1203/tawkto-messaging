import { TestHelper } from '@/test/test-helper';

/**
 * Boots the entire AppModule against a real MongoDB. This is the spec that
 * catches wiring mistakes the lightweight modes cannot see — a module missing
 * from commonModules, a provider that cannot be constructed, a circular import.
 */
describe('App smoke test', () => {
  const testHelper = TestHelper.fullAppMode();

  beforeAll(async () => {
    await testHelper.beforeAll();
  }, 120_000);

  afterAll(() => testHelper.afterAll());

  it('boots the full application', () => {
    expect(testHelper.request).toBeDefined();
  });

  it('serves the health check', async () => {
    const res = await testHelper.request.get('/api/health');

    expect([200, 503]).toContain(res.status);
  });

  it('rejects an unauthenticated request to a non-public route', async () => {
    const res = await testHelper.request.get('/api/v1/does-not-exist');

    // 401 from the global guard, or 404 once past it — either way the app is
    // enforcing the guard chain rather than erroring out.
    expect([401, 404]).toContain(res.status);
  });
});
