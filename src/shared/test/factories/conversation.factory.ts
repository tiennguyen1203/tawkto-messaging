import { ClsService } from 'nestjs-cls';

import { BaseRepository } from '@/shared/base.repository';
import { ConversationModel } from '@/messaging/cores/models/conversation.model';
import { ConversationRepository } from '@/messaging/cores/repositories/conversation.repository';
import { CachingService } from '@/shared/infra/caching/service';
import { ConnectionSingleton } from '@/shared/infra/database/connection.singleton';
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
      // The factory seeds MongoDB and never reads through the cache. A stub that
      // throws keeps seeding free of a cache dependency, and makes an accidental
      // `factory.repository().findCachedSummaryInTenant(...)` say so.
      {
        getOrSet: () => {
          throw new Error(
            'ConversationFactory builds a repository for seeding, not for cached reads.',
          );
        },
      } as unknown as CachingService,
    );
  }
}
