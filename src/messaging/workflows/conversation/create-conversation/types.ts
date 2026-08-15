export namespace CreateConversationUseCaseTypes {
  export type Input = {
    creatorId: string;
    participantIds: string[];
  };

  export type Output = {
    id: string;
    tenantId: string;
    participantIds: string[];
    createdAt: Date;
  };
}
