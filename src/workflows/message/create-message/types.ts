export namespace CreateMessageUseCaseTypes {
  export type Input = {
    conversationId: string;
    senderId: string;
    content: string;
    metadata?: Record<string, unknown>;
  };

  export type Output = {
    id: string;
    tenantId: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  };
}
