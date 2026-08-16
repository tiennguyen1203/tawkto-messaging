import { PageResult } from '@/shared/pagination/cursor';

export namespace SearchConversationMessagesUseCaseTypes {
  export type Input = {
    conversationId: string;
    /** The caller, from the token. Reading needs the same membership as writing. */
    requesterId: string;
    /** The text to match. `q` on the wire; spelled out once inside. */
    text: string;
    limit: number;
    cursor?: string;
  };

  /**
   * Deliberately the same shape the listing endpoint returns, minus `metadata`:
   * the index maps it as `flattened` for filtering, not for reading back, and a
   * client that wants it can fetch the message. Sharing the shape means a client
   * can render a search result and a message with the same component.
   */
  export type MessageHit = {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: Date;
  };

  /**
   * `total` is required here where the listing output leaves it optional.
   * Elasticsearch reports a hit count as a by-product of the query it already
   * ran; counting a keyset page in MongoDB would be a second, unbounded scan
   * (ADR-004). It is approximate above ten thousand.
   */
  export type Output = PageResult<MessageHit> & { total: number };
}
