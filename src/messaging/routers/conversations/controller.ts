import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { AuthUserType } from '@/shared/types/auth-user.type';
import { CreateConversationUseCase } from '@/messaging/workflows/conversation/create-conversation/usecase';
import { ListConversationsUseCase } from '@/messaging/workflows/conversation/list-conversations/usecase';
import { DEFAULT_PAGE_LIMIT } from '@/shared/pagination/cursor';
import { ROUTE_VERSION } from '@/shared/routes.config';
import { API_TAGS, ROUTES } from '@/messaging/common/routes.config';
import { CreateConversationDtos, ListConversationsDtos } from './dtos';

@Controller({ version: [ROUTE_VERSION.v1] })
@ApiTags(API_TAGS.conversations)
@ApiBearerAuth()
export class ConversationsController {
  constructor(
    private readonly createConversationUseCase: CreateConversationUseCase,
    private readonly listConversationsUseCase: ListConversationsUseCase,
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

  @Get(ROUTES.conversations.index)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListConversationsDtos.ResponseDto })
  @ApiOperation({
    operationId: 'listConversations',
    description:
      'The conversations the caller participates in, newest first. There is no ' +
      "way to list a tenant's conversations: the message endpoints refuse the " +
      'ones you are not in, and an endpoint that named them would be a directory ' +
      'of things to be told no about.',
  })
  async listConversations(
    @Query() query: ListConversationsDtos.QueryDto,
    @GetAuthUser() user: AuthUserType,
  ): Promise<ListConversationsDtos.ResponseDto> {
    return this.listConversationsUseCase.executeOrThrowHttpError({
      participantId: user.id,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: query.cursor,
    });
  }
}
