import { Injectable, Logger } from '@nestjs/common';

import {
  decodeCursor,
  encodeCursor,
  TimeCursor,
} from '@/common/pagination/cursor';
import { ConversationRepository } from '@/cores/repositories/conversation.repository';
import { MessageRepository } from '@/cores/repositories/message.repository';
import {
  BaseUseCase,
  NotFoundUseCaseError,
} from '@/workflows/shared/base-use-case';
import { GetConversationMessagesUseCaseTypes } from './types';

@Injectable()
export class GetConversationMessagesUseCase extends BaseUseCase<
  GetConversationMessagesUseCaseTypes.Input,
  GetConversationMessagesUseCaseTypes.Output
> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
  ) {
    super(new Logger(GetConversationMessagesUseCase.name));
  }

  async handle(
    input: GetConversationMessagesUseCaseTypes.Input,
  ): Promise<GetConversationMessagesUseCaseTypes.Output> {
    const conversation = await this.conversationRepository.findByIdInTenant(
      input.conversationId,
    );

    if (!conversation) {
      throw new NotFoundUseCaseError('Conversation not found.');
    }

    const cursor = decodeCursor<TimeCursor>(input.cursor);

    // Fetch one extra row: its presence is what tells us another page exists,
    // without paying for a second count query.
    const rows = await this.messageRepository.pageByConversation({
      conversationId: input.conversationId,
      limit: input.limit + 1,
      before: cursor
        ? { timestamp: new Date(cursor.timestamp), id: cursor.id }
        : undefined,
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        id: row._id.toString(),
        conversationId: row.conversationId.toString(),
        senderId: row.senderId,
        content: row.content,
        timestamp: row.timestamp,
        metadata: row.metadata,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              timestamp: last.timestamp.toISOString(),
              id: last._id.toString(),
            } satisfies TimeCursor)
          : null,
      hasMore,
    };
  }
}
