import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { AppClsStore } from '@/infra/cls/module';
import { ConversationRepository } from '@/cores/repositories/conversation.repository';
import { MessageSearchIndex } from '@/infra/elasticsearch/message-search.index';
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
    private readonly searchIndex: MessageSearchIndex,
    private readonly cls: ClsService<AppClsStore>,
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

    // The index is not a tenant-scoped repository: it also serves the consumer,
    // which runs outside any request and has no CLS to read. So the tenant
    // travels as an argument here rather than ambiently — taken from the verified
    // token, never from anything the caller sent.
    //
    // Throwing rather than searching unscoped, for the same reason the repository
    // does: every failure mode of a missing tenant is a leak. Unreachable in
    // practice — the conversation lookup above already ran through a tenant-scoped
    // repository, which would have thrown first.
    const tenantId = this.cls.isActive() ? this.cls.get('tenantId') : undefined;

    if (!tenantId) {
      throw new Error(
        'SearchConversationMessagesUseCase was used outside a tenant context.',
      );
    }

    const page = await this.searchIndex.search({
      tenantId,
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
