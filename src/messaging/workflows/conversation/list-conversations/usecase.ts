import { Injectable, Logger } from '@nestjs/common';

import { ConversationRepository } from '@/messaging/cores/repositories/conversation.repository';
import {
  decodeCursor,
  encodeCursor,
  TimeCursor,
} from '@/shared/pagination/cursor';
import { BaseUseCase } from '@/shared/use-case/base-use-case';
import { ListConversationsUseCaseTypes } from './types';

/**
 * Everything the caller is a participant of, newest first.
 *
 * There is no "list all conversations in the tenant" behind this and there should
 * not be: the tenant scopes what exists, participation scopes what is yours, and
 * the read paths for messages enforce exactly the same pair. An endpoint that
 * listed a tenant's conversations would hand every user the ids the message
 * endpoints then refuse — a directory of things to be told no about.
 */
@Injectable()
export class ListConversationsUseCase extends BaseUseCase<
  ListConversationsUseCaseTypes.Input,
  ListConversationsUseCaseTypes.Output
> {
  constructor(private readonly conversationRepository: ConversationRepository) {
    super(new Logger(ListConversationsUseCase.name));
  }

  async handle(
    input: ListConversationsUseCaseTypes.Input,
  ): Promise<ListConversationsUseCaseTypes.Output> {
    const cursor = decodeCursor<TimeCursor>(input.cursor);

    // One extra row: its presence is what says another page exists, without a
    // second count query. Same trick as the message list.
    const rows = await this.conversationRepository.pageByParticipant({
      participantId: input.participantId,
      limit: input.limit + 1,
      before: cursor
        ? { createdAt: new Date(cursor.timestamp), id: cursor.id }
        : undefined,
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        id: row._id.toString(),
        participantIds: row.participantIds,
        createdAt: row.createdAt,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              timestamp: last.createdAt.toISOString(),
              id: last._id.toString(),
            } satisfies TimeCursor)
          : null,
      hasMore,
    };
  }
}
