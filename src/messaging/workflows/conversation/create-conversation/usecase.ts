import { Injectable, Logger } from '@nestjs/common';

import { MIN_CONVERSATION_PARTICIPANTS } from '@/messaging/common/constants';
import { ConversationRepository } from '@/messaging/cores/repositories/conversation.repository';
import {
  BaseUseCase,
  InvalidInputUseCaseError,
} from '@/shared/use-case/base-use-case';
import { CreateConversationUseCaseTypes } from './types';

@Injectable()
export class CreateConversationUseCase extends BaseUseCase<
  CreateConversationUseCaseTypes.Input,
  CreateConversationUseCaseTypes.Output
> {
  constructor(private readonly conversationRepository: ConversationRepository) {
    super(new Logger(CreateConversationUseCase.name));
  }

  async handle(
    input: CreateConversationUseCaseTypes.Input,
  ): Promise<CreateConversationUseCaseTypes.Output> {
    // The creator is always a participant. Letting them create a conversation
    // they cannot post into would be a trap with no legitimate use. The Set also
    // collapses the duplicate when they list themselves as well.
    const participantIds = [
      ...new Set(
        input.creatorId
          ? [input.creatorId, ...input.participantIds]
          : input.participantIds,
      ),
    ];

    // Checked here, not in the DTO: the creator is merged in and duplicates
    // collapsed above, so this is the first point where membership is final. An
    // empty list and a list naming only the creator both land here.
    if (participantIds.length < MIN_CONVERSATION_PARTICIPANTS) {
      throw new InvalidInputUseCaseError(
        'A conversation needs at least one participant besides its creator.',
      );
    }

    // No tenantId here on purpose: the repository stamps it from the request
    // context, so this use case cannot write into the wrong tenant even by
    // mistake, and does not need to read CLS at all.
    const created = await this.conversationRepository.createOne({
      participantIds,
    });

    return {
      id: created._id.toString(),
      tenantId: created.tenantId,
      participantIds: created.participantIds,
      createdAt: created.createdAt,
    };
  }
}
