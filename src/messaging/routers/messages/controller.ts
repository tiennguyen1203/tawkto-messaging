import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { GetAuthUser } from '@/shared/decorators/auth-user.decorator';
import { DEFAULT_PAGE_LIMIT } from '@/shared/pagination/cursor';
import { AuthUserType } from '@/shared/types/auth-user.type';
import { CreateMessageUseCase } from '@/messaging/workflows/message/create-message/usecase';
import { GetConversationMessagesUseCase } from '@/messaging/workflows/message/get-conversation-messages/usecase';
import { SearchConversationMessagesUseCase } from '@/messaging/workflows/message/search-conversation-messages/usecase';
import { ROUTE_VERSION } from '@/shared/routes.config';
import { API_TAGS, ROUTES } from '@/messaging/common/routes.config';
import {
  CreateMessageDtos,
  ListMessagesDtos,
  SearchMessagesDtos,
} from './dtos';

@Controller({ version: [ROUTE_VERSION.v1] })
@ApiTags(API_TAGS.messages)
@ApiBearerAuth()
export class MessagesController {
  constructor(
    private readonly createMessageUseCase: CreateMessageUseCase,
    private readonly getConversationMessagesUseCase: GetConversationMessagesUseCase,
    private readonly searchConversationMessagesUseCase: SearchConversationMessagesUseCase,
  ) {}

  @Post(ROUTES.messages)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreateMessageDtos.ResponseDto })
  @ApiOperation({ operationId: 'createMessage' })
  async createMessage(
    @Body() body: CreateMessageDtos.RequestDto,
    @GetAuthUser() user: AuthUserType,
  ): Promise<CreateMessageDtos.ResponseDto> {
    return this.createMessageUseCase.executeOrThrowHttpError({
      conversationId: body.conversationId,
      // The sender is who the token says it is, never who the body claims.
      senderId: user.id,
      content: body.content,
      metadata: body.metadata,
    });
  }

  @Get(ROUTES.conversations.messages)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListMessagesDtos.ResponseDto })
  @ApiOperation({ operationId: 'getConversationMessages' })
  async getConversationMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesDtos.QueryDto,
  ): Promise<ListMessagesDtos.ResponseDto> {
    return this.getConversationMessagesUseCase.executeOrThrowHttpError({
      conversationId,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: query.cursor,
    });
  }

  @Get(ROUTES.conversations.messagesSearch)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SearchMessagesDtos.ResponseDto })
  @ApiOperation({ operationId: 'searchConversationMessages' })
  async searchConversationMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: SearchMessagesDtos.QueryDto,
  ): Promise<SearchMessagesDtos.ResponseDto> {
    return this.searchConversationMessagesUseCase.executeOrThrowHttpError({
      conversationId,
      text: query.q,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: query.cursor,
    });
  }
}
