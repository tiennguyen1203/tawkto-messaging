import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { GetAuthUser } from '@/shared/decorators/auth-user.decorator';
import { AuthUserType } from '@/shared/types/auth-user.type';
import { CreateConversationUseCase } from '@/messaging/workflows/conversation/create-conversation/usecase';
import { ROUTE_VERSION } from '@/shared/routes.config';
import { API_TAGS, ROUTES } from '@/messaging/common/routes.config';
import { CreateConversationDtos } from './dtos';

@Controller({ version: [ROUTE_VERSION.v1] })
@ApiTags(API_TAGS.conversations)
@ApiBearerAuth()
export class ConversationsController {
  constructor(
    private readonly createConversationUseCase: CreateConversationUseCase,
  ) {}

  @Post(ROUTES.conversations.index)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreateConversationDtos.ResponseDto })
  @ApiOperation({ operationId: 'createConversation' })
  async createConversation(
    @Body() body: CreateConversationDtos.RequestDto,
    @GetAuthUser() user: AuthUserType,
  ): Promise<CreateConversationDtos.ResponseDto> {
    return this.createConversationUseCase.executeOrThrowHttpError({
      creatorId: user.id,
      participantIds: body.participantIds,
    });
  }
}
