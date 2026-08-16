import { PageResult } from '@/shared/pagination/cursor';

export namespace GetConversationMessagesUseCaseTypes {
  export type Input = {
    conversationId: string;
    /** The caller, from the token. Reading needs the same membership as writing. */
    requesterId: string;
    limit: number;
    cursor?: string;
  };

  export type MessageItem = {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  };

  export type Output = PageResult<MessageItem>;
}
