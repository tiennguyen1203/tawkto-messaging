import { Injectable, Logger } from '@nestjs/common';

import {
  decodeCursor,
  encodeCursor,
  TimeCursor,
} from '@/shared/pagination/cursor';
import { ConversationRepository } from '@/messaging/cores/repositories/conversation.repository';
import { MessageRepository } from '@/messaging/cores/repositories/message.repository';
import {
  BaseUseCase,
  NotFoundUseCaseError,
  PermissionDeniedUseCaseError,
} from '@/shared/use-case/base-use-case';
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
    // The cached summary, the same one the write path uses: both questions asked
    // here — does it exist in my tenant, and am I in it — are answered by it, and
    // reading a conversation is at least as hot as writing to one.
    const conversation =
      await this.conversationRepository.findCachedSummaryInTenant(
        input.conversationId,
      );

    if (!conversation) {
      // Another tenant's conversation must be indistinguishable from one that was
      // never there. 403 here would confirm it exists.
      throw new NotFoundUseCaseError('Conversation not found.');
    }

    if (!conversation.participantIds.includes(input.requesterId)) {
      throw new PermissionDeniedUseCaseError(
        'Reader is not a participant of this conversation.',
      );
    }

    // Membership is checked on the way in, not on the way out. Filtering the rows
    // instead would answer 200 with an empty page, which tells a non-participant
    // that the conversation exists and is empty — and told the wrong story to
    // anyone reading the code, since "no messages" and "not yours" would look the
    // same.

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
