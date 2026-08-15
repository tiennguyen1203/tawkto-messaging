import { Injectable } from '@nestjs/common';
import { getModelForClass } from '@typegoose/typegoose';
import { Connection, Types } from 'mongoose';

import { BaseRepository } from '@/shared/base.repository';
import { UserModel } from '../models/user.model';

/**
 * Also not tenant-scoped, for a different reason than TenantRepository.
 *
 * Its callers are the seeding endpoints and token issuance, and both run before
 * anyone is authenticated — there is no request tenant to inherit. The tenant is
 * therefore passed explicitly and visibly, which is the same bargain
 * `forTenant()` strikes on the messaging side.
 */
@Injectable()
export class UserRepository extends BaseRepository<UserModel> {
  constructor(connection: Connection) {
    super(getModelForClass(UserModel, { existingConnection: connection }));
  }

  findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return Promise.resolve(null);
    }

    return this.findOne({ _id: new Types.ObjectId(id) });
  }

  findByEmailInTenant(tenantId: string, email: string) {
    return this.findOne({ tenantId, email });
  }

  listByTenant(tenantId: string) {
    return this.find({ tenantId }, { sort: { createdAt: -1 }, limit: 200 });
  }
}
