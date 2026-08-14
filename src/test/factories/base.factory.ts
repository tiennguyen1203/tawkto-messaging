import { BaseModel } from '@/cores/models/base.model';
import { BaseRepository, Doc } from '@/common/base.repository';

/**
 * Minimal replacement for @jorgebodega/typeorm-factory, which has no MongoDB
 * equivalent. Keeps the same `.make()` / `.create()` surface so specs read the
 * same as they did before the port.
 *
 * `make()` builds an unsaved attribute bag; `create()` persists it.
 */
export abstract class BaseFactory<T extends BaseModel> {
  protected abstract definition(): Partial<T>;
  protected abstract repository(): BaseRepository<T>;

  make(overrides: Partial<T> = {}): Partial<T> {
    return { ...this.definition(), ...overrides };
  }

  makeMany(count: number, overrides: Partial<T> = {}): Partial<T>[] {
    return Array.from({ length: count }, () => this.make(overrides));
  }

  create(overrides: Partial<T> = {}): Promise<Doc<T>> {
    return this.repository().createOne(this.make(overrides));
  }

  async createMany(
    count: number,
    overrides: Partial<T> = {},
  ): Promise<Doc<T>[]> {
    // Sequential rather than Promise.all: several specs depend on creation order
    // being reflected in _id order, which concurrent inserts would scramble.
    const created: Doc<T>[] = [];
    for (let i = 0; i < count; i += 1) {
      created.push(await this.create(overrides));
    }
    return created;
  }
}
