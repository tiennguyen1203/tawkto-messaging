import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';

import { API_TAGS, ROUTES } from '../routes.config';
import { PublicRoute } from '@/common/decorators/public-route.decorator';
import { RedisHealthIndicator } from './redis.health';

@Controller(ROUTES.health)
@ApiTags(API_TAGS.health)
@PublicRoute()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: MongooseHealthIndicator,
    private redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    operationId: 'healthCheck',
  })
  check() {
    return this.health.check([
      () => this.db.pingCheck('mongodb'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
