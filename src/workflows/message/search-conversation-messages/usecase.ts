import { Injectable, Logger } from '@nestjs/common';

import { ConversationRepository } from '@/cores/repositories/conversation.repository';
import { MessageRepository } from '@/cores/repositories/message.repository';
import {
  BaseUseCase,
  NotFoundUseCaseError,
} from '@/workflows/shared/base-use-case';
import { SearchConversationMessagesUseCaseTypes } from './types';

@Injectable()
export class SearchConversationMessagesUseCase extends BaseUseCase<
  SearchConversationMessagesUseCaseTypes.Input,
  SearchConversationMessagesUseCaseTypes.Output
> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
  ) {
    super(new Logger(SearchConversationMessagesUseCase.name));
  }

  async handle(
    input: SearchConversationMessagesUseCaseTypes.Input,
  ): Promise<SearchConversationMessagesUseCaseTypes.Output> {
    // MongoDB answers "may this caller see this conversation at all", and it is
    // the tenant-scoped repository that answers it — so a conversation belonging
    // to another tenant is simply not found. Asking Elasticsearch first would
    // return an empty page instead, which reads to a client as "no matches" and
    // quietly hides the difference between an empty conversation and one that is
    // none of their business.
    const conversation = await this.conversationRepository.findByIdInTenant(
      input.conversationId,
    );

    if (!conversation) {
      throw new NotFoundUseCaseError('Conversation not found.');
    }

    // No tenant is passed. The repository inherits it from the request the same
    // way every other query does — this use case has no business knowing which
    // tenant it is serving, and there is one fewer place for that to be got
    // wrong.
    const page = await this.messageRepository.search({
      conversationId: input.conversationId,
      text: input.text,
      limit: input.limit,
      cursor: input.cursor,
    });

    return {
      items: page.items.map((hit) => ({
        id: hit.messageId,
        conversationId: hit.conversationId,
        senderId: hit.senderId,
        content: hit.content,
        // The index stores epoch milliseconds to match its `epoch_millis`
        // mapping; the API speaks dates, like every other endpoint.
        timestamp: new Date(hit.timestamp),
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total: page.total,
    };
  }
}
