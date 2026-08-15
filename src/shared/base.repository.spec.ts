import { TestHelper } from '@/shared/test/test-helper';
import {
  TestDocRepository,
  TestDocFactory,
} from '@/shared/test/support/test-doc';

/**
 * Guards against the "undefined filter -> arbitrary document / whole collection"
 * landmine described in base.repository.ts. Every one of these would pass
 * silently — and destructively — without the guards.
 */
describe('@common/base.repository', () => {
  const testHelper = TestHelper.lightweightMode(TestDocRepository);
  let repo: TestDocRepository;

  beforeAll(async () => {
    await testHelper.beforeAll();
    repo = testHelper.unit;
  }, 120_000);

  afterAll(() => testHelper.afterAll());
  afterEach(() => testHelper.cleanUp());

  describe('#findOne', () => {
    describe('when every condition in the filter is undefined', () => {
      it('should throw rather than return an arbitrary document', async () => {
        // A document exists — unguarded, this call would have returned it.
        await new TestDocFactory().create();

        await expect(
          repo.findOne({ name: undefined as unknown as string }),
        ).rejects.toThrow(/empty filter/);
      });
    });

    describe('when the filter is literally empty', () => {
      it('should throw', async () => {
        await new TestDocFactory().create();

        await expect(repo.findOne({})).rejects.toThrow(/empty filter/);
      });
    });

    describe('when the filter is an empty $or', () => {
      it('should throw, with a clearer message than Mongo would give', async () => {
        await expect(repo.findOne({ $or: [] })).rejects.toThrow(/empty filter/);
      });
    });

    describe('when the filter carries a real condition', () => {
      it('should resolve the matching document', async () => {
        const doc = await new TestDocFactory().create({ name: 'findable' });

        const found = await repo.findOne({ name: 'findable' });

        expect(found?._id.toString()).toBe(doc._id.toString());
      });
    });
  });

  describe('#deleteMany', () => {
    describe('when every condition in the filter is undefined', () => {
      it('should throw rather than wipe the collection', async () => {
        await new TestDocFactory().createMany(3);

        await expect(
          repo.deleteMany({ name: undefined as unknown as string }),
        ).rejects.toThrow(/every document/);

        expect(await repo.count()).toBe(3);
      });
    });

    describe('when the filter carries a real condition', () => {
      it('should delete only the matching documents', async () => {
        await new TestDocFactory().create({ name: 'doomed' });
        await new TestDocFactory().create({ name: 'spared' });

        expect(await repo.deleteMany({ name: 'doomed' })).toBe(1);
        expect(await repo.count()).toBe(1);
      });
    });
  });

  describe('#updateMany', () => {
    describe('when the filter is empty', () => {
      it('should throw rather than rewrite every document', async () => {
        await new TestDocFactory().createMany(2, { score: 1 });

        await expect(
          repo.updateMany({}, { $set: { score: 999 } }),
        ).rejects.toThrow(/every document/);

        const docs = await repo.find();
        expect(docs.every((d) => d.score === 1)).toBe(true);
      });
    });
  });

  describe('#createOne', () => {
    describe('when a document is created', () => {
      it('should stamp createdAt and updatedAt from the schema', async () => {
        const doc = await repo.createOne({
          tenantId: 'tenant-a',
          name: 'fresh',
        });

        expect(doc.createdAt).toBeInstanceOf(Date);
        expect(doc.updatedAt).toBeInstanceOf(Date);
      });

      it('should expose the string id virtual that crosses the API boundary', async () => {
        const doc = await repo.createOne({
          tenantId: 'tenant-a',
          name: 'fresh',
        });

        expect(doc.id).toBe(doc._id.toString());
      });
    });
  });
});
