/**
 * Six partitions, keyed by `conversationId`, so every message of a conversation
 * lands on one partition and is consumed in order. Six is also the ceiling on
 * useful consumer instances — see docs/back-of-envelope.md for why that is ample.
 */
export const MESSAGE_CREATED_PARTITIONS = 6;
