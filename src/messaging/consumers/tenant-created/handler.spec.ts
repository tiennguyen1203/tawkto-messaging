import { messageAliasFor } from '@/messaging/common/constants';
import { MessageSearchIndex } from '@/messaging/infra/elasticsearch/message-search.index';
import { SearchHelper } from '@/messaging/test/search-helper';
import { TenantCreatedHandler } from './handler';
import { TenantCreatedEvent } from './tenant-created.event';

describe('@messaging/consumers/tenant-created/handler', () => {
  const helper = new SearchHelper('tenant-provision-spec');
  let tenantCreatedHandler: TenantCreatedHandler;

  beforeAll(async () => {
    await helper.setUp();
    tenantCreatedHandler = new TenantCreatedHandler(
      new MessageSearchIndex(helper.client),
    );
  }, 180_000);

  afterAll(() => helper.tearDown());
  afterEach(() => helper.cleanUp());

  const aliasExists = (tenantId: string) =>
    helper.client.indices.existsAlias({ name: messageAliasFor(tenantId) });

  describe('when a tenant is created', () => {
    it('should create its alias before any message exists', async () => {
      // The whole point of the event: by the time the tenant's first message
      // arrives, the alias is already there rather than being made on the write
      // path.
      const tenantId = helper.tenant('fresh');
      expect(await aliasExists(tenantId)).toBe(false);

      await tenantCreatedHandler.handleBatch([{ tenantId }]);

      expect(await aliasExists(tenantId)).toBe(true);
    });

    it('should give it the tenant filter, not a bare name', async () => {
      const tenantId = helper.tenant('filtered');

      await tenantCreatedHandler.handleBatch([{ tenantId }]);

      const aliases = await helper.client.indices.getAlias({
        name: messageAliasFor(tenantId),
      });
      const [definition] = Object.values(aliases).map(
        (body) => body.aliases[messageAliasFor(tenantId)],
      );

      expect(definition.filter).toEqual({ term: { tenantId } });
    });
  });

  describe('when the same event is delivered twice', () => {
    it('should do nothing the second time', async () => {
      // Delivery is at-least-once and the consumer reads from the beginning, so
      // redelivery is the normal case rather than the exceptional one.
      const tenantId = helper.tenant('twice');

      await tenantCreatedHandler.handleBatch([{ tenantId }]);
      await tenantCreatedHandler.handleBatch([{ tenantId }]);

      expect(await aliasExists(tenantId)).toBe(true);
    });
  });

  describe('when a batch carries several tenants', () => {
    it('should provision each of them', async () => {
      const first = helper.tenant('batch-a');
      const second = helper.tenant('batch-b');

      await tenantCreatedHandler.handleBatch([
        { tenantId: first },
        { tenantId: second },
      ]);

      expect(await aliasExists(first)).toBe(true);
      expect(await aliasExists(second)).toBe(true);
    });
  });

  describe('when a record has no tenantId', () => {
    it('should skip it and still provision the rest', async () => {
      // A malformed record must not wedge the partition behind it — the same
      // reasoning as the message stream, where records from an older transform
      // chain arrive without an id.
      const tenantId = helper.tenant('sound');

      await tenantCreatedHandler.handleBatch([
        { tenantId: undefined as unknown as string },
        { tenantId },
      ] as TenantCreatedEvent[]);

      expect(await aliasExists(tenantId)).toBe(true);
    });
  });
});
