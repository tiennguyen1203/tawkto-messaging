import { TestHelper } from '@/test/test-helper';
import { TestDocRepository, TestDocFactory } from '@/test/support/test-doc';

/**
 * Guards against the "undefined filter -> arbitrary document / whole collection"
 * landmine described in base.repository.ts. Every one of these tests would pass
 * silently — and destructively — without the guards.
 */
describe('@common/base.repository guards', () => {
  const testHelper = TestHelper.lightweightMode(TestDocRepository);
  let repo: TestDocRepository;

  beforeAll(async () => {
    await testHelper.beforeAll();
    repo = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  describe('findOne', () => {
    it('throws on an all-undefined filter instead of returning an arbitrary document', async () => {
      // A document exists — the unguarded behaviour would have returned THIS one.
      await new TestDocFactory().create();

      await expect(
        repo.findOne({ name: undefined as unknown as string }),
      ).rejects.toThrow(/empty filter/);
    });

    it('throws on a literally empty filter', async () => {
      await new TestDocFactory().create();

      await expect(repo.findOne({})).rejects.toThrow(/empty filter/);
    });

    it('throws on an empty $or, which Mongo itself would reject with a worse message', async () => {
      await expect(repo.findOne({ $or: [] })).rejects.toThrow(/empty filter/);
    });

    it('still resolves a real condition', async () => {
      const doc = await new TestDocFactory().create({ name: 'findable' });

      const found = await repo.findOne({ name: 'findable' });

      expect(found?._id.toString()).toBe(doc._id.toString());
    });
  });

  describe('deleteMany', () => {
    it('throws on an all-undefined filter instead of wiping the collection', async () => {
      await new TestDocFactory().createMany(3);

      await expect(
        repo.deleteMany({ name: undefined as unknown as string }),
      ).rejects.toThrow(/every document/);

      expect(await repo.count()).toBe(3);
    });

    it('still deletes with a real filter', async () => {
      await new TestDocFactory().create({ name: 'doomed' });
      await new TestDocFactory().create({ name: 'spared' });

      expect(await repo.deleteMany({ name: 'doomed' })).toBe(1);
      expect(await repo.count()).toBe(1);
    });
  });

  describe('updateMany', () => {
    it('throws on an empty filter instead of rewriting every document', async () => {
      await new TestDocFactory().createMany(2, { score: 1 });

      await expect(
        repo.updateMany({}, { $set: { score: 999 } }),
      ).rejects.toThrow(/every document/);

      const docs = await repo.find();
      expect(docs.every((d) => d.score === 1)).toBe(true);
    });
  });

  describe('createOne', () => {
    it('persists and stamps createdAt/updatedAt from the schema', async () => {
      const doc = await repo.createOne({ tenantId: 'tenant-a', name: 'fresh' });

      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
      // The string `id` virtual is what crosses the API boundary.
      expect(doc.id).toBe(doc._id.toString());
    });
  });
});
