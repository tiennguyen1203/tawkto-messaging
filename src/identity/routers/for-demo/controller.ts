import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { PublicRoute } from '@/shared/decorators/public-route.decorator';
import { ROUTE_VERSION } from '@/shared/routes.config';
import { ForDemoOnlyGuard } from '@/identity/common/guards/for-demo-only.guard';
import { API_TAGS, ROUTES } from '@/identity/common/routes.config';
import { CreateTenantUseCase } from '@/identity/workflows/create-tenant/usecase';
import { CreateUserUseCase } from '@/identity/workflows/create-user/usecase';
import { IssueTokenUseCase } from '@/identity/workflows/issue-token/usecase';
import { ListTenantsUseCase } from '@/identity/workflows/list-tenants/usecase';
import { ListUsersUseCase } from '@/identity/workflows/list-users/usecase';
import {
  CreateTenantDtos,
  CreateUserDtos,
  IssueTokenDtos,
  ListTenantsDtos,
  ListUsersDtos,
} from './dtos';

/**
 * Seeding for a local demonstration: create a tenant, put users in it, and get a
 * token for one of them.
 *
 * `@PublicRoute` because there is nobody to authenticate as until this controller has
 * run — a token comes from here, so requiring one here would be a closed loop.
 * `ForDemoOnlyGuard` is what keeps that from being a hole: outside a local
 * environment every route below is refused.
 */
@Controller({ version: [ROUTE_VERSION.v1] })
@ApiTags(API_TAGS.forDemo)
@PublicRoute()
@UseGuards(ForDemoOnlyGuard)
export class ForDemoController {
  constructor(
    private readonly createTenantUseCase: CreateTenantUseCase,
    private readonly listTenantsUseCase: ListTenantsUseCase,
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly listUsersUseCase: ListUsersUseCase,
    private readonly issueTokenUseCase: IssueTokenUseCase,
  ) {}

  @Post(ROUTES.tenants)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreateTenantDtos.ResponseDto })
  @ApiOperation({ operationId: 'createTenant' })
  async createTenant(
    @Body() body: CreateTenantDtos.RequestDto,
  ): Promise<CreateTenantDtos.ResponseDto> {
    return this.createTenantUseCase.executeOrThrowHttpError({
      name: body.name,
    });
  }

  @Get(ROUTES.tenants)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListTenantsDtos.ResponseDto })
  @ApiOperation({
    operationId: 'listTenants',
    description:
      'Every tenant there is. The demo UI needs one before it can ask for users, ' +
      'and nothing else in the system enumerates tenants — see the use case for ' +
      'why that is deliberate.',
  })
  async listTenants(): Promise<ListTenantsDtos.ResponseDto> {
    return this.listTenantsUseCase.executeOrThrowHttpError();
  }

  @Post(ROUTES.users)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreateUserDtos.ResponseDto })
  @ApiOperation({ operationId: 'createUser' })
  async createUser(
    @Body() body: CreateUserDtos.RequestDto,
  ): Promise<CreateUserDtos.ResponseDto> {
    return this.createUserUseCase.executeOrThrowHttpError({
      tenantId: body.tenantId,
      email: body.email,
      displayName: body.displayName,
      roles: body.roles ?? [],
    });
  }

  @Get(ROUTES.users)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListUsersDtos.ResponseDto })
  @ApiOperation({ operationId: 'listUsers' })
  async listUsers(
    @Query() query: ListUsersDtos.QueryDto,
  ): Promise<ListUsersDtos.ResponseDto> {
    return this.listUsersUseCase.executeOrThrowHttpError({
      tenantId: query.tenantId,
    });
  }

  @Post(ROUTES.tokens)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: IssueTokenDtos.ResponseDto })
  @ApiOperation({ operationId: 'issueToken' })
  async issueToken(
    @Body() body: IssueTokenDtos.RequestDto,
  ): Promise<IssueTokenDtos.ResponseDto> {
    return this.issueTokenUseCase.executeOrThrowHttpError({
      userId: body.userId,
    });
  }
}
