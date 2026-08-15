/**
 * The shape that arrives on `KafkaTopic.MessageChanged`.
 *
 * This is the stored MongoDB document after Debezium's unwrap transform has
 * flattened the change envelope — captured from a running stack, not inferred
 * from documentation. A verbatim sample is in docs/PLAN.md.
 *
 * It is the persistence document, not a curated domain event: the coupling was
 * accepted in D13 because the search index is a read model inside the same
 * bounded context, and D32 records why a cosmetic rename of `_id` was reverted.
 * The moment a consumer outside this context subscribes, the answer is a second,
 * curated topic rather than a change here.
 *
 * Three details are easy to get wrong and were verified against real output:
 *   · `_id` and `conversationId` arrive as hex strings, not `{ "$oid": … }`.
 *   · the date fields arrive as epoch milliseconds, not ISO strings.
 *   · `__deleted` is added by the unwrap transform and is `false` or `"false"`
 *     for inserts, so a consumer must not assume the field is absent.
 */
export type MessageChangeEvent = {
  _id: string;
  tenantId: string;
  conversationId: string;
  senderId: string;
  content: string;
  /** Epoch milliseconds. */
  timestamp: number;
  metadata?: Record<string, unknown>;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  __deleted?: boolean | string;
};

/** The Kafka record key: the conversation the message belongs to. */
export type MessageChangeKey = string;

export const isDeletion = (event: MessageChangeEvent): boolean =>
  event.__deleted === true || event.__deleted === 'true';

/**
 * Whether the record carries the three fields the index cannot work without.
 *
 * The type above describes what the connector *should* publish; nothing enforces
 * it at run time, and a record shaped by an older transform chain will parse
 * cleanly and still be missing `_id`. Left unchecked that becomes an
 * Elasticsearch-generated document id, and the redelivery that was supposed to
 * overwrite writes a second copy instead — verified against records this repo's
 * own M2 connector produced before D32 was reverted.
 */
export const isIndexable = (event: MessageChangeEvent): boolean =>
  Boolean(event._id && event.tenantId && event.conversationId);
