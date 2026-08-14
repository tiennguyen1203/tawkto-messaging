import { ClsService } from 'nestjs-cls';

import { BaseRepository } from '@/common/base.repository';
import { ConversationModel } from '@/cores/models/conversation.model';
import { ConversationRepository } from '@/cores/repositories/conversation.repository';
import { ConnectionSingleton } from '@/infra/database/connection.singleton';
import { BaseFactory } from './base.factory';

/**
 * Factories write directly, bypassing the tenant scoping the repository applies
 * to reads, so a spec can seed another tenant's data and then prove it is
 * invisible.
 */
const anyTenantCls = (tenantId: string) =>
  ({
    isActive: () => true,
    get: (key?: string) => (key === 'tenantId' ? tenantId : undefined),
    set: () => undefined,
  }) as unknown as ClsService<any>;

export class ConversationFactory extends BaseFactory<ConversationModel> {
  constructor(private readonly tenantId = 'tenant-a') {
    super();
  }

  protected definition(): Partial<ConversationModel> {
    return {
      tenantId: this.tenantId,
      participantIds: ['alice', 'bob'],
    };
  }

  protected repository(): BaseRepository<ConversationModel> {
    return new ConversationRepository(
      ConnectionSingleton.get(),
      anyTenantCls(this.tenantId),
    );
  }
}
