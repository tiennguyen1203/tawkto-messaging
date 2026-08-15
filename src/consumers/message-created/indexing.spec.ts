import { toSearchDocument } from './indexing';
import { MessageCreatedEvent } from './message-created.event';

const event = (
  overrides: Partial<MessageCreatedEvent> = {},
): MessageCreatedEvent => ({
  _id: '6a7fd7adba0e4ad4a76ffabc',
  tenantId: 'tenant-a',
  conversationId: '6a7fd7adba0e4ad4a76ffab9',
  senderId: 'alice',
  content: 'after-revert',
  timestamp: 1786763181092,
  metadata: { k: 1 },
  createdAt: 1786763181093,
  updatedAt: 1786763181093,
  __deleted: false,
  ...overrides,
});

describe('@consumers/message-created/indexing', () => {
  describe('#toSearchDocument', () => {
    describe('when mapping an event the connector produced', () => {
      it('should carry only the fields the index maps', () => {
        // Exact equality, not a subset match: the index is `dynamic: strict`, so
        // forwarding Debezium's own bookkeeping would make Elasticsearch reject
        // the whole batch rather than the one document.
        expect(toSearchDocument(event())).toEqual({
          messageId: '6a7fd7adba0e4ad4a76ffabc',
          tenantId: 'tenant-a',
          conversationId: '6a7fd7adba0e4ad4a76ffab9',
          senderId: 'alice',
          content: 'after-revert',
          timestamp: 1786763181092,
          metadata: { k: 1 },
        });
      });

      it('should rename the Mongo primary key to the index own', () => {
        expect(toSearchDocument(event({ _id: 'abc' })).messageId).toBe('abc');
      });

      it('should keep the timestamp in epoch milliseconds', () => {
        // The connector emits numbers, and the mapping declares `epoch_millis`.
        // Converting to a Date here would be a silent format mismatch.
        expect(toSearchDocument(event()).timestamp).toBe(1786763181092);
      });
    });

    describe('when the event carries no metadata', () => {
      it('should leave the field out rather than inventing one', () => {
        const mapped = toSearchDocument(event({ metadata: undefined }));

        expect(mapped.metadata).toBeUndefined();
      });
    });
  });
});
