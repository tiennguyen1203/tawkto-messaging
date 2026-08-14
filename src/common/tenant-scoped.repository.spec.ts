import { TestHelper } from '@/test/test-helper';
import {
  TenantScopedTestDocRepository,
  TestDocFactory,
} from '@/test/support/test-doc';

/**
 * Multi-tenant isolation is a property of the repository, not a discipline
 * applied at each call site — so it is tested here, once, rather than in every
 * use case spec.
 */
describe('@common/tenant-scoped.repository', () => {
  const testHelper = TestHelper.lightweightMode(TenantScopedTestDocRepository);
  let repo: TenantScopedTestDocRepository;

  beforeAll(async () => {
    await testHelper.beforeAll();
    repo = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  describe('with a tenant in context', () => {
    beforeEach(() => {
      testHelper.setTenant('tenant-a');
    });

    it("does not see another tenant's documents", async () => {
      await new TestDocFactory().create({
        tenantId: 'tenant-b',
        name: 'secret',
      });

      expect(await repo.findByName('secret')).toBeNull();
      expect(await repo.listAll()).toHaveLength(0);
    });

    it('sees its own documents', async () => {
      await new TestDocFactory().create({ tenantId: 'tenant-a', name: 'mine' });
      await new TestDocFactory().create({ tenantId: 'tenant-b', name: 'mine' });

      const found = await repo.findByName('mine');

      expect(found?.tenantId).toBe('tenant-a');
      expect(await repo.listAll()).toHaveLength(1);
    });

    it('cannot delete across tenants even with a matching filter', async () => {
      await new TestDocFactory().create({
        tenantId: 'tenant-b',
        name: 'theirs',
      });
      await new TestDocFactory().create({ tenantId: 'tenant-a', name: 'ours' });

      expect(await repo.deleteAllScoped()).toBe(1);

      // The other tenant's document survived.
      const survivors = await repo.find();
      expect(survivors).toHaveLength(1);
      expect(survivors[0].tenantId).toBe('tenant-b');
    });
  });

  describe('without a tenant in context', () => {
    beforeEach(() => {
      testHelper.setTenant(undefined as unknown as string);
    });

    it('refuses to run rather than silently querying every tenant', async () => {
      await new TestDocFactory().create();

      await expect(repo.listAll()).rejects.toThrow(/outside a tenant context/);
    });

    it('works when a tenant is stated explicitly, for consumers and jobs', async () => {
      await new TestDocFactory().create({
        tenantId: 'tenant-b',
        name: 'via-job',
      });

      const found = await repo.forTenant('tenant-b').findByName('via-job');

      expect(found?.name).toBe('via-job');
    });
  });
});
