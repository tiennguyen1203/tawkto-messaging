/**
 * Turns on change stream pre-images for the messages collection.
 *
 * A MongoDB delete event normally carries only the document key. Debezium's
 * `ValueToKey` transform re-keys every record by `conversationId` (D12), so a
 * delete with no `conversationId` in its value makes the transform throw
 * `DataException: Field does not exist` — and the connector task then dies on a
 * record it re-reads on every restart. One `deleteOne` stops change data capture
 * for *every* operation until the offsets are reset by hand. Verified on compose
 * in M3.2, which is where it was found.
 *
 * With pre-images on, a delete carries the whole previous document: the SMT chain
 * keeps working, the record lands on the same partition as the insert it deletes,
 * and the consumer gets the `tenantId` it needs to address the right alias.
 *
 * Paired with `capture.mode: change_streams_with_pre_image` in
 * `infra/debezium/message-connector.json`. Both are required; neither works alone.
 *
 * Pre-images cost storage — MongoDB retains them per the cluster's
 * `changeStreamOptions.preAndPostImages.expireAfterSeconds`, which defaults to
 * off-with-oplog-retention, so they age out with the oplog itself.
 */

module.exports = {
  async up(db) {
    await db.command({
      collMod: 'messages',
      changeStreamPreAndPostImages: { enabled: true },
    });
  },

  async down(db) {
    await db.command({
      collMod: 'messages',
      changeStreamPreAndPostImages: { enabled: false },
    });
  },
};
