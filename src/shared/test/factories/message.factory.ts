import { faker } from '@faker-js/faker';
import { Types } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { BaseRepository } from '@/shared/base.repository';
import { MessageModel } from '@/messaging/cores/models/message.model';
import { MessageRepository } from '@/messaging/cores/repositories/message.repository';
import { MessageSearchIndex } from '@/messaging/infra/elasticsearch/message-search.index';
import { ConnectionSingleton } from '@/shared/infra/database/connection.singleton';
import { BaseFactory } from './base.factory';

const anyTenantCls = (tenantId: string) =>
  ({
    isActive: () => true,
    get: (key?: string) => (key === 'tenantId' ? tenantId : undefined),
    set: () => undefined,
  }) as unknown as ClsService<any>;

export class MessageFactory extends BaseFactory<MessageModel> {
  constructor(private readonly tenantId = 'tenant-a') {
    super();
  }

  protected definition(): Partial<MessageModel> {
    return {
      tenantId: this.tenantId,
      conversationId: new Types.ObjectId(),
      senderId: 'alice',
      content: faker.lorem.sentence(),
      timestamp: new Date(),
    };
  }

  protected repository(): BaseRepository<MessageModel> {
    return new MessageRepository(
      ConnectionSingleton.get(),
      anyTenantCls(this.tenantId),
      // The factory seeds MongoDB and never searches. Handing it a stub that
      // throws rather than a real index keeps the seeding path free of an
      // Elasticsearch connection, and turns a future `factory.repository()
      // .search(...)` into a clear error instead of a confusing crash.
      {
        search: () => {
          throw new Error(
            'MessageFactory builds a repository for seeding, not for searching.',
          );
        },
      } as unknown as MessageSearchIndex,
    );
  }
}
