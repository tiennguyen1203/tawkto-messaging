import { Global, Module } from '@nestjs/common';

import { CreateConversationUseCase } from './conversation/create-conversation/usecase';
import { ListConversationsUseCase } from './conversation/list-conversations/usecase';
import { CreateMessageUseCase } from './message/create-message/usecase';
import { GetConversationMessagesUseCase } from './message/get-conversation-messages/usecase';
import { SearchConversationMessagesUseCase } from './message/search-conversation-messages/usecase';

const useCases = [
  CreateConversationUseCase,
  ListConversationsUseCase,
  CreateMessageUseCase,
  GetConversationMessagesUseCase,
  SearchConversationMessagesUseCase,
];

@Global()
@Module({
  providers: [...useCases],
  exports: [...useCases],
})
export class WorkflowsModule {}
