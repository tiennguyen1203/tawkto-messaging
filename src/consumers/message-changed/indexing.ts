import { MessageSearchDocument } from '@/infra/elasticsearch/message-search.index';
import { MessageChangeEvent } from './message-changed.event';

/**
 * Narrows a change event down to what the index maps, dropping Debezium's own
 * bookkeeping (`__deleted`) and the document's audit columns.
 *
 * Not merely tidy: the index is `dynamic: strict`, so forwarding a field the
 * mapping does not know rejects the entire bulk request rather than the one
 * document. This function is the only place the two shapes meet.
 */
export const toSearchDocument = (
  event: MessageChangeEvent,
): MessageSearchDocument => ({
  messageId: event._id,
  tenantId: event.tenantId,
  conversationId: event.conversationId,
  senderId: event.senderId,
  content: event.content,
  timestamp: event.timestamp,
  metadata: event.metadata,
});
