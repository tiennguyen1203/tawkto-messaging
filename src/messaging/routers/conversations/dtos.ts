import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/shared/pagination/cursor';

export namespace CreateConversationDtos {
  @ApiSchema({ name: 'CreateConversationRequestDto' })
  export class RequestDto {
    @ApiProperty({
      type: () => [String],
      description:
        'Participants. The authenticated caller is added automatically if absent.',
      example: ['bob'],
    })
    @IsArray()
    // An empty array is almost always a client that forgot to fill it; saying so
    // by field name beats the use case's message about final membership.
    @ArrayMinSize(1)
    @ArrayMaxSize(1000)
    @IsString({ each: true })
    @MaxLength(128, { each: true })
    participantIds: string[];
  }

  @ApiSchema({ name: 'CreateConversationResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => String })
    id: string;

    @ApiProperty({ type: () => String })
    tenantId: string;

    @ApiProperty({ type: () => [String] })
    participantIds: string[];

    @ApiProperty({ type: () => Date })
    createdAt: Date;
  }
}

export namespace ListConversationsDtos {
  @ApiSchema({ name: 'ListConversationsQueryDto' })
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

  /**
   * Deliberately narrower than the create response: no `tenantId`. Every row of
   * this list has the same one, it is the caller's own, and it is already in the
   * token they sent — repeating it per row is noise that reads as though it might
   * sometimes differ.
   */
  @ApiSchema({ name: 'ConversationSummaryDto' })
  export class ItemDto {
    @ApiProperty({ type: () => String })
    id: string;

    @ApiProperty({ type: () => [String] })
    participantIds: string[];

    @ApiProperty({ type: () => Date })
    createdAt: Date;
  }

  @ApiSchema({ name: 'ListConversationsResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => [ItemDto] })
    items: ItemDto[];

    @ApiProperty({ type: () => String, nullable: true })
    nextCursor: string | null;

    @ApiProperty({ type: () => Boolean })
    hasMore: boolean;
  }
}
