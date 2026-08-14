import { faker } from '@faker-js/faker';
import { Types } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { BaseRepository } from '@/common/base.repository';
import { MessageModel } from '@/cores/models/message.model';
import { MessageRepository } from '@/cores/repositories/message.repository';
import { ConnectionSingleton } from '@/infra/database/connection.singleton';
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
    );
  }
}
