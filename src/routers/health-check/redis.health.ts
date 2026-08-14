import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { CachingService } from '@/infra/caching/service';

@Injectable()
export class RedisHealthIndicator {
  private readonly HEALTH_CHECK_KEY = 'health-check';

  constructor(
    private readonly cachingService: CachingService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const testValue = Date.now().toString();
      await this.cachingService.set(this.HEALTH_CHECK_KEY, testValue, 1000);
      const result = await this.cachingService.get<string>(
        this.HEALTH_CHECK_KEY,
      );

      if (result === testValue) {
        return indicator.up();
      }

      return indicator.down({ message: 'Redis health check failed' });
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
