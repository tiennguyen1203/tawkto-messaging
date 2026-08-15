import { Module } from '@nestjs/common';

import { SearchModule } from '@/infra/elasticsearch/module';
import { MessageCreatedConsumer } from './message-created/consumer';
import { MessageCreatedHandler } from './message-created/handler';

@Module({
  imports: [SearchModule],
  providers: [MessageCreatedConsumer, MessageCreatedHandler],
})
export class ConsumersModule {}
