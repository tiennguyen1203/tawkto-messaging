export namespace ListConversationsUseCaseTypes {
  export type Input = {
    /** The caller, from the token. You only ever see your own conversations. */
    participantId: string;
    limit: number;
    cursor?: string;
  };

  export type ConversationItem = {
    id: string;
    participantIds: string[];
    createdAt: Date;
  };

  export type Output = {
    items: ConversationItem[];
    nextCursor: string | null;
    hasMore: boolean;
  };
}
