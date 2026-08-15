import { Module } from '@nestjs/common';

import { commonModules } from './app.module';
import { ConsumersModule } from './consumers/module';

/**
 * The consumer entrypoint's module: the same infrastructure the API loads, plus
 * the Kafka subscription, and none of the HTTP layer.
 */
@Module({
  imports: [...commonModules, ConsumersModule],
})
export class ConsumerModule {}
