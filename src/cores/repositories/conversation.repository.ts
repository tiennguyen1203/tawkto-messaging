import { Injectable } from '@nestjs/common';
import { getModelForClass } from '@typegoose/typegoose';
import { Connection, Types } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { TenantScopedRepository } from '@/common/tenant-scoped.repository';
import { AppClsStore } from '@/infra/cls/module';
import { ConversationModel } from '../models/conversation.model';

@Injectable()
export class ConversationRepository extends TenantScopedRepository<ConversationModel> {
  constructor(connection: Connection, cls: ClsService<AppClsStore>) {
    super(
      getModelForClass(ConversationModel, { existingConnection: connection }),
      cls,
    );
  }

  /**
   * Scoped by construction: a conversation belonging to another tenant is
   * indistinguishable from one that does not exist.
   */
  findByIdInTenant(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return Promise.resolve(null);
    }

    return this.findOne({ _id: new Types.ObjectId(id) });
  }
}
