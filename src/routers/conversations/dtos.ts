import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

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
