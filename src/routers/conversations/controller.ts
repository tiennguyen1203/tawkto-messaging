import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { GetAuthUser } from '@/common/decorators/auth-user.decorator';
import { AuthUserType } from '@/common/types/auth-user.type';
import { CreateConversationUseCase } from '@/workflows/conversation/create-conversation/usecase';
import { API_TAGS, ROUTE_VERSION, ROUTES } from '../routes.config';
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
