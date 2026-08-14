import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { Trim } from '@/common/decorators/transforms/trim';
import { MAX_MESSAGE_CONTENT_LENGTH } from '@/common/constants';
import { MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT } from '@/common/pagination/cursor';

export namespace CreateMessageDtos {
  @ApiSchema({ name: 'CreateMessageRequestDto' })
  export class RequestDto {
    @ApiProperty({ type: () => String })
    @IsMongoId()
    conversationId: string;

    @ApiProperty({ type: () => String, maxLength: MAX_MESSAGE_CONTENT_LENGTH })
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
    content: string;

    @ApiPropertyOptional({ type: () => Object })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;

    // NOTE: there is deliberately no `senderId` and no `timestamp` here. The
    // sender is the authenticated caller and the timestamp is the server's —
    // accepting either from the body would let a client impersonate someone or
    // rewrite history. `whitelist: true` strips them if sent.
  }

  @ApiSchema({ name: 'MessageResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => String })
    id: string;

    @ApiProperty({ type: () => String })
    conversationId: string;

    @ApiProperty({ type: () => String })
    senderId: string;

    @ApiProperty({ type: () => String })
    content: string;

    @ApiProperty({ type: () => Date })
    timestamp: Date;

    @ApiPropertyOptional({ type: () => Object })
    metadata?: Record<string, unknown>;
  }
}

export namespace ListMessagesDtos {
  @ApiSchema({ name: 'ListMessagesQueryDto' })
  export class QueryDto {
    @ApiPropertyOptional({
      type: () => Number,
      default: DEFAULT_PAGE_LIMIT,
      maximum: MAX_PAGE_LIMIT,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE_LIMIT)
    limit?: number = DEFAULT_PAGE_LIMIT;

    @ApiPropertyOptional({
      type: () => String,
      description: 'Opaque cursor from the previous page.',
    })
    @IsOptional()
    @IsString()
    cursor?: string;
  }

  @ApiSchema({ name: 'ListMessagesResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => [CreateMessageDtos.ResponseDto] })
    items: CreateMessageDtos.ResponseDto[];

    @ApiProperty({ type: () => String, nullable: true })
    nextCursor: string | null;

    @ApiProperty({ type: () => Boolean })
    hasMore: boolean;
  }
}
