import { ModelType } from '@typegoose/typegoose/lib/types';
import { FilterQuery, QueryOptions, Types, UpdateQuery } from 'mongoose';
import { BaseModel } from '@/cores/models/base.model';

/**
 * The hydrated document type a typegoose model actually returns.
 *
 * Derived from `hydrate()` rather than written out, because typegoose leaves
 * mongoose's THydratedDocumentType at its default and spelling that default by
 * hand does not structurally match once T is a generic parameter.
 */
export type Doc<T> = ReturnType<ModelType<T>['hydrate']>;

/**
 * MongoDB ignores `undefined` values in a filter, so `{ tenantId: undefined }`
 * collapses to `{}`. A read (`findOne`) then returns an ARBITRARY document —
 * in a multi-tenant system, one belonging to somebody else. A write
 * (`updateMany` / `deleteMany`) affects EVERY document in the collection.
 *
 * This is the same landmine TypeORM has, but worse: Mongo has no foreign keys or
 * transactions in the default deployment to blunt the blast radius, and the
 * failure is silent — no error, no warning, just the wrong rows.
 *
 * These guards refuse any call whose conditions all evaporated, turning a silent
 * catastrophe into a loud one.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof Types.ObjectId);

export const hasNoDefinedCondition = (filter: unknown): boolean => {
  if (filter === undefined || filter === null) {
    return true;
  }

  if (!isPlainObject(filter)) {
    // A non-object filter (never valid for Mongo) is not something we can vouch
    // for; treat it as unusable rather than passing it through.
    return true;
  }

  const entries = Object.entries(filter);

  if (entries.length === 0) {
    return true;
  }

  return entries.every(([key, value]) => {
    if (value === undefined) {
      return true;
    }

    // `$or: []` and `$and: []` are as empty as `{}` — and `$or: []` actually
    // throws in Mongo, so catching it here gives a far better message.
    if (
      (key === '$or' || key === '$and' || key === '$nor') &&
      Array.isArray(value)
    ) {
      return value.length === 0 || value.every(hasNoDefinedCondition);
    }

    return false;
  });
};

export const assertUsableFilter = (filter: unknown, label: string): void => {
  if (hasNoDefinedCondition(filter)) {
    throw new Error(
      `${label} was called with an empty filter; refusing to affect every document.`,
    );
  }
};

export const assertUsableReadFilter = (
  filter: unknown,
  label: string,
): void => {
  if (hasNoDefinedCondition(filter)) {
    throw new Error(
      `${label} was called with an empty filter; refusing to return an arbitrary document.`,
    );
  }
};

export const toObjectId = (id: string | Types.ObjectId): Types.ObjectId =>
  typeof id === 'string' ? new Types.ObjectId(id) : id;

export class BaseRepository<T extends BaseModel> {
  constructor(protected readonly model: ModelType<T>) {}

  protected get label(): string {
    return this.model.modelName;
  }

  /**
   * The collection this repository reads and writes. Exposed so tests can assert
   * against the collection the application really uses instead of a hardcoded
   * name that may not match.
   */
  get collectionName(): string {
    return this.model.collection.name;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async findOne(
    filter: FilterQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<Doc<T> | null> {
    assertUsableReadFilter(filter, `${this.label}.findOne`);
    return this.model.findOne(filter, null, options).exec();
  }

  async findOneOrFail(
    filter: FilterQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<Doc<T>> {
    const found = await this.findOne(filter, options);
    if (!found) {
      throw new Error(`${this.label} not found`);
    }
    return found;
  }

  async findById(id: string | Types.ObjectId): Promise<Doc<T> | null> {
    return this.findOne({ _id: toObjectId(id) } as FilterQuery<T>);
  }

  /**
   * Unguarded on purpose: listing a whole collection is a legitimate read, and
   * tenant scoping is enforced by TenantScopedRepository rather than here.
   */
  async find(
    filter: FilterQuery<T> = {},
    options?: QueryOptions<T>,
  ): Promise<Doc<T>[]> {
    return this.model.find(filter, null, options).exec();
  }

  async exists(filter: FilterQuery<T>): Promise<boolean> {
    assertUsableReadFilter(filter, `${this.label}.exists`);
    return (await this.model.exists(filter)) !== null;
  }

  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  // ── writes ───────────────────────────────────────────────────────────────

  async createOne(data: Partial<T>): Promise<Doc<T>> {
    const [created] = await this.model.create([data]);
    return created;
  }

  async createMany(data: Partial<T>[]): Promise<Doc<T>[]> {
    return this.model.create(data);
  }

  async updateOne(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<number> {
    assertUsableFilter(filter, `${this.label}.updateOne`);
    const result = await this.model.updateOne(filter, update).exec();
    return result.modifiedCount;
  }

  async updateMany(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<number> {
    assertUsableFilter(filter, `${this.label}.updateMany`);
    const result = await this.model.updateMany(filter, update).exec();
    return result.modifiedCount;
  }

  async findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<Doc<T> | null> {
    assertUsableFilter(filter, `${this.label}.findOneAndUpdate`);
    return this.model
      .findOneAndUpdate(filter, update, { new: true, ...options })
      .exec();
  }

  async updateById(
    id: string | Types.ObjectId,
    data: UpdateQuery<T>,
  ): Promise<Doc<T> | null> {
    return this.findOneAndUpdate(
      { _id: toObjectId(id) } as FilterQuery<T>,
      data,
    );
  }

  async deleteOne(filter: FilterQuery<T>): Promise<number> {
    assertUsableFilter(filter, `${this.label}.deleteOne`);
    const result = await this.model.deleteOne(filter).exec();
    return result.deletedCount;
  }

  async deleteMany(filter: FilterQuery<T>): Promise<number> {
    assertUsableFilter(filter, `${this.label}.deleteMany`);
    const result = await this.model.deleteMany(filter).exec();
    return result.deletedCount;
  }

  async deleteById(id: string | Types.ObjectId): Promise<number> {
    return this.deleteOne({
      _id: toObjectId(id),
    } as FilterQuery<T>);
  }
}
