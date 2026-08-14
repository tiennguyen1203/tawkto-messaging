import { Injectable } from '@nestjs/common';
import { getModelForClass, prop } from '@typegoose/typegoose';
import { Connection } from 'mongoose';
import { ClsService } from 'nestjs-cls';
import { faker } from '@faker-js/faker';

import { TenantScopedModel } from '@/cores/models/base.model';
import { BaseRepository } from '@/common/base.repository';
import { TenantScopedRepository } from '@/common/tenant-scoped.repository';
import { AppClsStore } from '@/infra/cls/module';
import { ConnectionSingleton } from '@/infra/database/connection.singleton';
import { BaseFactory } from '../factories/base.factory';

/**
 * A throwaway model used only to exercise BaseRepository and
 * TenantScopedRepository against a real MongoDB. Keeping it in the test tree
 * means those guards are covered from M0, before any domain model exists.
 */
export class TestDoc extends TenantScopedModel {
  @prop({ required: true, type: () => String })
  name!: string;

  @prop({ type: () => Number })
  score?: number;
}

@Injectable()
export class TestDocRepository extends BaseRepository<TestDoc> {
  constructor(connection: Connection) {
    super(getModelForClass(TestDoc, { existingConnection: connection }));
  }
}

@Injectable()
export class TenantScopedTestDocRepository extends TenantScopedRepository<TestDoc> {
  constructor(connection: Connection, cls: ClsService<AppClsStore>) {
    super(getModelForClass(TestDoc, { existingConnection: connection }), cls);
  }

  // `async` matters: the tenant guard throws while building the filter, and a
  // Promise-returning method must reject rather than throw synchronously.
  async findByName(name: string) {
    return this.findOne(this.scoped({ name }));
  }

  async listAll() {
    return this.find(this.scoped());
  }

  async deleteAllScoped() {
    return this.deleteMany(this.scoped());
  }
}

export class TestDocFactory extends BaseFactory<TestDoc> {
  protected definition(): Partial<TestDoc> {
    return {
      tenantId: 'tenant-a',
      name: faker.word.noun(),
      score: faker.number.int({ min: 0, max: 100 }),
    };
  }

  protected repository(): BaseRepository<TestDoc> {
    return new TestDocRepository(ConnectionSingleton.get());
  }
}
