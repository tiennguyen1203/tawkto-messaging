/**
 * Indexes for the messaging collections.
 *
 * These are the single source of truth — `autoIndex` is off in every
 * environment, so what this file declares is exactly what the database has.
 * See ADR-005.
 */

const MESSAGE_LIST_INDEX = 'tenant_conversation_timestamp_id';

module.exports = {
  async up(db) {
    await db.collection('messages').createIndex(
      // Field order matches the keyset query in MessageRepository exactly:
      // equality on tenantId and conversationId, then the descending sort key.
      // With the sort key in the index, Mongo walks it and never sorts in
      // memory, so page 500 costs the same as page 1.
      { tenantId: 1, conversationId: 1, timestamp: -1, _id: -1 },
      { name: MESSAGE_LIST_INDEX },
    );
  },

  async down(db) {
    await db.collection('messages').dropIndex(MESSAGE_LIST_INDEX);
  },
};
