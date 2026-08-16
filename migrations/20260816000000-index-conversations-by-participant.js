/**
 * The index behind `GET /api/v1/conversations`.
 *
 * Added when the demo UI grew a conversation list: without it, listing somebody's
 * conversations is a collection scan and an in-memory sort, which is fine with
 * eleven conversations in the database and is not fine later.
 *
 * Same shape as the message list index — equality fields first, then the exact
 * descending sort key — so Mongo walks the index and never sorts. `participantIds`
 * is an array, which makes this a multikey index: one entry per participant per
 * conversation. See ADR-005 for why this lives here and not in a decorator.
 */

const CONVERSATION_LIST_INDEX = 'tenant_participant_createdAt_id';

module.exports = {
  async up(db) {
    await db
      .collection('conversations')
      .createIndex(
        { tenantId: 1, participantIds: 1, createdAt: -1, _id: -1 },
        { name: CONVERSATION_LIST_INDEX },
      );
  },

  async down(db) {
    await db.collection('conversations').dropIndex(CONVERSATION_LIST_INDEX);
  },
};
