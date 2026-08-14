import { Global, Module } from '@nestjs/common';

import { CreateConversationUseCase } from './conversation/create-conversation/usecase';
import { CreateMessageUseCase } from './message/create-message/usecase';
import { GetConversationMessagesUseCase } from './message/get-conversation-messages/usecase';

const useCases = [
  CreateConversationUseCase,
  CreateMessageUseCase,
  GetConversationMessagesUseCase,
];

@Global()
@Module({
  providers: [...useCases],
  exports: [...useCases],
})
export class WorkflowsModule {}
