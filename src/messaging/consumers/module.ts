import { Module } from '@nestjs/common';

import { SearchModule } from '@/messaging/infra/elasticsearch/module';
import { MessageChangeConsumer } from './message-changed/consumer';
import { TenantCreatedConsumer } from './tenant-created/consumer';
import { TenantCreatedHandler } from './tenant-created/handler';
import { MessageChangeHandler } from './message-changed/handler';

@Module({
  imports: [SearchModule],
  providers: [
    MessageChangeConsumer,
    MessageChangeHandler,
    TenantCreatedConsumer,
    TenantCreatedHandler,
  ],
})
export class ConsumersModule {}
