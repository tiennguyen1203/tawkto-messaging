import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Trim } from '@/shared/decorators/transforms/trim';

const MAX_NAME_LENGTH = 200;

export namespace CreateTenantDtos {
  @ApiSchema({ name: 'CreateTenantRequestDto' })
  export class RequestDto {
    @ApiProperty({ type: () => String, maxLength: MAX_NAME_LENGTH })
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_NAME_LENGTH)
    name: string;
  }

  @ApiSchema({ name: 'CreateTenantResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => String })
    id: string;

    @ApiProperty({ type: () => String })
    name: string;

    @ApiProperty({ type: () => Date })
    createdAt: Date;
  }
}

export namespace ListTenantsDtos {
  @ApiSchema({ name: 'ListTenantsResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => [CreateTenantDtos.ResponseDto] })
    items: CreateTenantDtos.ResponseDto[];
  }
}

export namespace CreateUserDtos {
  @ApiSchema({ name: 'CreateUserRequestDto' })
  export class RequestDto {
    @ApiProperty({ type: () => String })
    @IsMongoId()
    tenantId: string;

    @ApiProperty({ type: () => String })
    @Trim()
    @IsEmail()
    email: string;

    @ApiProperty({ type: () => String, maxLength: MAX_NAME_LENGTH })
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_NAME_LENGTH)
    displayName: string;

    @ApiPropertyOptional({ type: () => [String], default: [] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(64, { each: true })
    roles?: string[] = [];
  }

  @ApiSchema({ name: 'UserResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => String })
    id: string;

    @ApiProperty({ type: () => String })
    tenantId: string;

    @ApiProperty({ type: () => String })
    email: string;

    @ApiProperty({ type: () => String })
    displayName: string;

    @ApiProperty({ type: () => [String] })
    roles: string[];
  }
}

export namespace ListUsersDtos {
  @ApiSchema({ name: 'ListUsersQueryDto' })
  export class QueryDto {
    @ApiProperty({ type: () => String })
    @IsMongoId()
    tenantId: string;
  }

  @ApiSchema({ name: 'ListUsersResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => [CreateUserDtos.ResponseDto] })
    items: CreateUserDtos.ResponseDto[];
  }
}

export namespace IssueTokenDtos {
  @ApiSchema({ name: 'IssueTokenRequestDto' })
  export class RequestDto {
    @ApiProperty({
      type: () => String,
      description:
        'The user to impersonate. No credential is checked — see the route name.',
    })
    @IsMongoId()
    userId: string;
  }

  @ApiSchema({ name: 'IssueTokenResponseDto' })
  export class ResponseDto {
    @ApiProperty({ type: () => String })
    accessToken: string;

    @ApiProperty({ type: () => String })
    expiresIn: string;

    @ApiProperty({ type: () => CreateUserDtos.ResponseDto })
    user: CreateUserDtos.ResponseDto;
  }
}
