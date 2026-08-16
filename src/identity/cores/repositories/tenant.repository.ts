import { Injectable } from '@nestjs/common';
import { getModelForClass } from '@typegoose/typegoose';
import { Connection, Types } from 'mongoose';

import { BaseRepository } from '@/shared/base.repository';
import { TenantModel } from '../models/tenant.model';

/**
 * Deliberately **not** a `TenantScopedRepository`.
 *
 * That base scopes every query to the tenant in CLS and throws when there is
 * none — correct everywhere except here, where the tenant is the thing being
 * created and cannot already be in scope.
 */
@Injectable()
export class TenantRepository extends BaseRepository<TenantModel> {
  constructor(connection: Connection) {
    super(getModelForClass(TenantModel, { existingConnection: connection }));
  }

  findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return Promise.resolve(null);
    }

    return this.findOne({ _id: new Types.ObjectId(id) });
  }

  /**
   * Newest first and capped, the same shape as `UserRepository.listByTenant`. The
   * cap is what stands in for pagination in a demo: a list that quietly stops at
   * 200 is a poor API, but an unbounded one is a worse failure, and this exists to
   * fill a dropdown.
   */
  listAll() {
    return this.find({}, { sort: { createdAt: -1 }, limit: 200 });
  }
}
