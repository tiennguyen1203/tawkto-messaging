import { TestHelper } from '@/shared/test/test-helper';
import {
  TestDoc,
  TenantScopedTestDocRepository,
  TestDocFactory,
} from '@/shared/test/support/test-doc';

/**
 * Multi-tenant isolation is a property of the repository, not a discipline
 * applied at each call site — so it is proven here, once, rather than in every
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

  describe('when a tenant is in context', () => {
    beforeEach(() => {
      testHelper.setTenant('tenant-a');
    });

    it("should not see another tenant's documents", async () => {
      await new TestDocFactory().create({
        tenantId: 'tenant-b',
        name: 'secret',
      });

      expect(await repo.findByName('secret')).toBeNull();
      expect(await repo.listAll()).toHaveLength(0);
    });

    it('should see its own documents', async () => {
      await new TestDocFactory().create({ tenantId: 'tenant-a', name: 'mine' });
      await new TestDocFactory().create({ tenantId: 'tenant-b', name: 'mine' });

      const found = await repo.findByName('mine');

      expect(found?.tenantId).toBe('tenant-a');
      expect(await repo.listAll()).toHaveLength(1);
    });

    it('should not delete across tenants even when the filter would match', async () => {
      await new TestDocFactory().create({
        tenantId: 'tenant-b',
        name: 'theirs',
      });
      await new TestDocFactory().create({ tenantId: 'tenant-a', name: 'ours' });

      expect(await repo.deleteAllScoped()).toBe(1);

      const survivors = await repo.acrossTenants().find();
      expect(survivors).toHaveLength(1);
      expect(survivors[0].tenantId).toBe('tenant-b');
    });
  });

  describe('when reading with the inherited methods', () => {
    beforeEach(() => {
      testHelper.setTenant('tenant-a');
    });

    it('should confine an unfiltered find to this tenant', async () => {
      await new TestDocFactory('tenant-a').create({ name: 'ours' });
      await new TestDocFactory('tenant-b').create({ name: 'theirs' });

      const all = await repo.find();

      expect(all.map((d) => d.name)).toEqual(['ours']);
      expect(await repo.count()).toBe(1);
    });

    it("should not resolve another tenant's document by id", async () => {
      const theirs = await new TestDocFactory('tenant-b').create({
        name: 'theirs',
      });

      expect(await repo.findById(theirs._id)).toBeNull();
      expect(await repo.exists({ name: 'theirs' })).toBe(false);
    });
  });

  describe('when writing by filter with the inherited methods', () => {
    beforeEach(() => {
      testHelper.setTenant('tenant-a');
    });

    it("should not update another tenant's document even when the filter matches", async () => {
      const theirs = await new TestDocFactory('tenant-b').create({
        name: 'shared-name',
        score: 1,
      });
      await new TestDocFactory('tenant-a').create({
        name: 'shared-name',
        score: 1,
      });

      const modified = await repo.updateMany(
        { name: 'shared-name' },
        { $set: { score: 99 } },
      );

      expect(modified).toBe(1);
      const untouched = await repo.forTenant('tenant-b').findById(theirs._id);
      expect(untouched!.score).toBe(1);
    });

    it("should not delete another tenant's document even when the filter matches", async () => {
      await new TestDocFactory('tenant-b').create({ name: 'shared-name' });
      await new TestDocFactory('tenant-a').create({ name: 'shared-name' });

      expect(await repo.deleteMany({ name: 'shared-name' })).toBe(1);
      expect(await repo.forTenant('tenant-b').count()).toBe(1);
    });

    it('should still refuse a filter whose conditions all evaporated', async () => {
      await new TestDocFactory('tenant-a').create({ name: 'ours' });

      // Scoping would bound the damage to one tenant, but wiping one tenant is
      // still a catastrophe — the guard reflects what the caller meant to say.
      await expect(
        repo.deleteMany({ name: undefined as unknown as string }),
      ).rejects.toThrow(/every document/);
      expect(await repo.count()).toBe(1);
    });
  });

  describe('when a caller deliberately reaches across tenants', () => {
    it('should see every tenant through acrossTenants()', async () => {
      testHelper.setTenant('tenant-a');
      await new TestDocFactory('tenant-a').create({ name: 'ours' });
      await new TestDocFactory('tenant-b').create({ name: 'theirs' });

      const all = await repo.acrossTenants().find();

      expect(all.map((d) => d.name).sort()).toEqual(['ours', 'theirs']);
    });

    it('should work with no tenant in context at all', async () => {
      testHelper.setTenant(undefined as unknown as string);
      await new TestDocFactory('tenant-b').create({ name: 'theirs' });

      expect(await repo.acrossTenants().count()).toBe(1);
    });

    it('should still refuse to write without a tenant, since a document must belong to one', async () => {
      testHelper.setTenant(undefined as unknown as string);

      await expect(
        repo.acrossTenants().createOne({ name: 'orphan' }),
      ).rejects.toThrow(/outside a tenant context/);
    });
  });

  describe('when writing with a tenant in context', () => {
    beforeEach(() => {
      testHelper.setTenant('tenant-a');
    });

    it('should stamp the tenant itself, so the caller cannot forget it', async () => {
      const created = await repo.createOne({ name: 'stamped' });

      expect(created.tenantId).toBe('tenant-a');
    });

    it('should stamp every document of a batch', async () => {
      const created = await repo.createMany([{ name: 'a' }, { name: 'b' }]);

      expect(created.map((d) => d.tenantId)).toEqual(['tenant-a', 'tenant-a']);
    });

    it('should refuse a payload naming a different tenant', async () => {
      // The signature already forbids this; the cast reaches the runtime
      // backstop that protects untyped callers.
      await expect(
        repo.createOne({
          tenantId: 'tenant-b',
          name: 'smuggled',
        } as Partial<TestDoc>),
      ).rejects.toThrow(/tenant/i);

      // Nothing reached the other tenant.
      expect(await repo.forTenant('tenant-b').count()).toBe(0);
    });

    it('should accept a payload naming the same tenant', async () => {
      const created = await repo.createOne({
        tenantId: 'tenant-a',
        name: 'explicit',
      } as Partial<TestDoc>);

      expect(created.tenantId).toBe('tenant-a');
    });
  });

  describe('when writing through forTenant', () => {
    beforeEach(() => {
      testHelper.setTenant(undefined as unknown as string);
    });

    it('should stamp the tenant that was named explicitly', async () => {
      const created = await repo
        .forTenant('tenant-b')
        .createOne({ name: 'via-job' });

      expect(created.tenantId).toBe('tenant-b');
    });
  });

  describe('when no tenant is in context', () => {
    beforeEach(() => {
      testHelper.setTenant(undefined as unknown as string);
    });

    it('should refuse to write rather than write an unscoped document', async () => {
      await expect(repo.createOne({ name: 'orphan' })).rejects.toThrow(
        /outside a tenant context/,
      );
    });

    it('should refuse to run rather than silently query every tenant', async () => {
      await new TestDocFactory().create();

      await expect(repo.listAll()).rejects.toThrow(/outside a tenant context/);
    });

    it('should work when a tenant is stated explicitly, for consumers and jobs', async () => {
      await new TestDocFactory().create({
        tenantId: 'tenant-b',
        name: 'via-job',
      });

      const found = await repo.forTenant('tenant-b').findByName('via-job');

      expect(found?.name).toBe('via-job');
    });
  });
});
