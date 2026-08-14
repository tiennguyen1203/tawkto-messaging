import { Module } from '@nestjs/common';

import { HealthCheckModule } from './health-check/health-check.module';
import { ConversationsController } from './conversations/controller';
import { MessagesController } from './messages/controller';

@Module({
  imports: [HealthCheckModule],
  controllers: [ConversationsController, MessagesController],
})
export class RoutersModule {}
