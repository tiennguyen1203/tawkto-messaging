import { Module } from '@nestjs/common';

import { SearchModule } from '@/messaging/infra/elasticsearch/module';
import { MessageChangeConsumer } from './message-changed/consumer';
import { MessageChangeHandler } from './message-changed/handler';

@Module({
  imports: [SearchModule],
  providers: [MessageChangeConsumer, MessageChangeHandler],
})
export class ConsumersModule {}
