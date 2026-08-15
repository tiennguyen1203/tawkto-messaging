import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';

import { ConversationRepository } from '@/messaging/cores/repositories/conversation.repository';
import { MessageRepository } from '@/messaging/cores/repositories/message.repository';
import {
  BaseUseCase,
  NotFoundUseCaseError,
  PermissionDeniedUseCaseError,
} from '@/shared/use-case/base-use-case';
import { CreateMessageUseCaseTypes } from './types';

@Injectable()
export class CreateMessageUseCase extends BaseUseCase<
  CreateMessageUseCaseTypes.Input,
  CreateMessageUseCaseTypes.Output
> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
  ) {
    super(new Logger(CreateMessageUseCase.name));
  }

  async handle(
    input: CreateMessageUseCaseTypes.Input,
  ): Promise<CreateMessageUseCaseTypes.Output> {
    // Cached: this read happens on every message posted, and returns the same
    // answer every time for a conversation that is being used. The key is scoped
    // to the tenant by the repository, not by this call.
    const conversation =
      await this.conversationRepository.findCachedSummaryInTenant(
        input.conversationId,
      );

    if (!conversation) {
      // Deliberately NOT_FOUND rather than a permission error: a conversation
      // belonging to another tenant must be indistinguishable from one that does
      // not exist, or the response confirms its existence.
      throw new NotFoundUseCaseError('Conversation not found.');
    }

    if (!conversation.participantIds.includes(input.senderId)) {
      // Safe as PERMISSION_DENIED: the conversation is known to exist within
      // this tenant, so 403 leaks nothing the caller could not already see.
      throw new PermissionDeniedUseCaseError(
        'Sender is not a participant of this conversation.',
      );
    }

    // Content shape — non-blank, within the length bound — is enforced by
    // CreateMessageDtos.RequestDto at the edge, where a failure becomes a 400
    // naming the offending field. What is left here needs loaded state and so
    // cannot live in a DTO.
    const created = await this.messageRepository.createOne({
      // No tenantId: the repository stamps it from the request context.
      // The summary is a plain projection, so the id comes back as a string.
      conversationId: new Types.ObjectId(conversation.id),
      senderId: input.senderId,
      content: input.content,
      // The server owns the clock — a client-supplied timestamp would let a
      // caller rewrite history. See ADR-006.
      timestamp: new Date(),
      metadata: input.metadata,
    });

    return {
      id: created._id.toString(),
      tenantId: created.tenantId,
      conversationId: created.conversationId.toString(),
      senderId: created.senderId,
      content: created.content,
      timestamp: created.timestamp,
      metadata: created.metadata,
    };
  }
}
