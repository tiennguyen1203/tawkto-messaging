import { PageResult } from '@/common/pagination/cursor';

export namespace GetConversationMessagesUseCaseTypes {
  export type Input = {
    conversationId: string;
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
