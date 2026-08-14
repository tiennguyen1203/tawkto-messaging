/**
 * Bounds the document size so a single message cannot blow past what the search
 * index and the Kafka record are sized for. See docs/back-of-envelope.md.
 */
export const MAX_MESSAGE_CONTENT_LENGTH = 4000;

/**
 * A conversation needs someone to talk to. Relaxing this to 1 is all it would
 * take to support a deliberate "note to self" conversation, should the product
 * ever want one.
 */
export const MIN_CONVERSATION_PARTICIPANTS = 2;
