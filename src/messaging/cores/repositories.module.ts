import { Global, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { SearchModule } from '@/messaging/infra/elasticsearch/module';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';

/**
 * Repositories are constructed from the mongoose `Connection` — a class token —
 * rather than from `@InjectModel`, whose string token the lightweight test
 * scanner cannot follow (see D3).
 *
 * @nestjs/mongoose only publishes the connection under its own string token, so
 * this alias is the bridge that makes the class usable as an injection token in
 * the real container. Without it the repositories resolve in tests and fail at
 * application boot.
 */
const connectionAlias = {
  provide: Connection,
  useExisting: getConnectionToken(),
};

const repositories = [ConversationRepository, MessageRepository];

@Global()
@Module({
  imports: [SearchModule],
  providers: [connectionAlias, ...repositories],
  exports: [...repositories],
})
export class RepositoriesModule {}
