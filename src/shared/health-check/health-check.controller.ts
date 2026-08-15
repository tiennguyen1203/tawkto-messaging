import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';

import { HEALTH_API_TAG, HEALTH_ROUTE } from '@/shared/routes.config';
import { PublicRoute } from '@/shared/decorators/public-route.decorator';
import { RedisHealthIndicator } from './redis.health';

@Controller(HEALTH_ROUTE)
@ApiTags(HEALTH_API_TAG)
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
