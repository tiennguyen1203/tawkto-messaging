import { ModelType } from '@typegoose/typegoose/lib/types';
import { FilterQuery, QueryOptions, UpdateQuery } from 'mongoose';
import { ClsService } from 'nestjs-cls';
import { TenantScopedModel } from '@/shared/models/base.model';
import { AppClsStore } from '@/shared/infra/cls/module';
import {
  assertUsableFilter,
  assertUsableReadFilter,
  BaseRepository,
  Doc,
} from './base.repository';

/**
 * What a caller may supply on a write: everything except the tenant, which the
 * repository stamps itself. Spelling this in the signature is what makes the
 * override honest — the call site can see it does not own `tenantId`.
 */
export type TenantScopedInput<T extends TenantScopedModel> = Omit<
  Partial<T>,
  'tenantId'
>;

/**
 * A repository confined to one tenant on every operation — reads, writes by
 * filter, and inserts alike.
 *
 * The tenant comes from CLS, populated once from the verified JWT. So an attacker
 * cannot reach another tenant by putting a `tenantId` in a body, param or query
 * string, and a developer cannot leak one by forgetting a clause: isolation is a
 * property of the repository, not a discipline applied at each call site.
 *
 * Every inherited method that takes a filter is overridden below, rather than a
 * `scoped()` helper being offered for call sites to remember to use. That is the
 * whole point — a helper you must remember is the discipline this class exists to
 * remove.
 *
 * Two named doors lead out, and they are the only ones:
 *   · `forTenant(id)`   — pin a specific tenant, for consumers, jobs and
 *                         migrations that run outside a request and so have no
 *                         CLS context.
 *   · `acrossTenants()` — lift the confinement, for genuinely global work such as
 *                         a platform-admin report. Grep for it to audit every
 *                         place isolation is set aside.
 *
 * Both are visible at the call site, which is the property that matters: a
 * cross-tenant query should be impossible to write by accident and trivial to
 * find on purpose.
 *
 * Not covered: a subclass reaching for `this.model` directly bypasses all of
 * this. TypeScript cannot prevent that; review has to.
 */
export abstract class TenantScopedRepository<
  T extends TenantScopedModel,
> extends BaseRepository<T> {
  constructor(
    model: ModelType<T>,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super(model);
  }

  /**
   * The tenant of the current request. Throws rather than falling back to an
   * unscoped query, because every failure mode of a missing tenant is a leak.
   */
  protected get tenantId(): string {
    const tenantId = this.cls.isActive() ? this.cls.get('tenantId') : undefined;

    if (!tenantId) {
      throw new Error(
        `${this.label} was used outside a tenant context. Use forTenant(tenantId) ` +
          `for work that runs outside a request (consumers, migrations, jobs), or ` +
          `acrossTenants() for work that is deliberately global.`,
      );
    }

    return tenantId;
  }

  protected scoped(filter: FilterQuery<T> = {}): FilterQuery<T> {
    return { ...filter, tenantId: this.tenantId } as FilterQuery<T>;
  }

  // ── reads ────────────────────────────────────────────────────────────────
  //
  // The guards run on the caller's filter *before* scoping. Scoping first would
  // defeat them: `{ name: undefined }` becomes `{ tenantId }`, a perfectly usable
  // filter, and the mistake would pass silently.

  override async findOne(
    filter: FilterQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<Doc<T> | null> {
    assertUsableReadFilter(filter, `${this.label}.findOne`);
    return super.findOne(this.scoped(filter), options);
  }

  override async find(
    filter: FilterQuery<T> = {},
    options?: QueryOptions<T>,
  ): Promise<Doc<T>[]> {
    return super.find(this.scoped(filter), options);
  }

  override async exists(filter: FilterQuery<T>): Promise<boolean> {
    assertUsableReadFilter(filter, `${this.label}.exists`);
    return super.exists(this.scoped(filter));
  }

  override async count(filter: FilterQuery<T> = {}): Promise<number> {
    return super.count(this.scoped(filter));
  }

  // ── writes by filter ─────────────────────────────────────────────────────

  override async updateOne(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<number> {
    assertUsableFilter(filter, `${this.label}.updateOne`);
    return super.updateOne(this.scoped(filter), update);
  }

  override async updateMany(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<number> {
    assertUsableFilter(filter, `${this.label}.updateMany`);
    return super.updateMany(this.scoped(filter), update);
  }

  override async findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<Doc<T> | null> {
    assertUsableFilter(filter, `${this.label}.findOneAndUpdate`);
    return super.findOneAndUpdate(this.scoped(filter), update, options);
  }

  override async deleteOne(filter: FilterQuery<T>): Promise<number> {
    assertUsableFilter(filter, `${this.label}.deleteOne`);
    return super.deleteOne(this.scoped(filter));
  }

  override async deleteMany(filter: FilterQuery<T>): Promise<number> {
    assertUsableFilter(filter, `${this.label}.deleteMany`);
    return super.deleteMany(this.scoped(filter));
  }

  // `findById`, `updateById` and `deleteById` are inherited unchanged: they route
  // through the primitives above, so polymorphism scopes them.

  // ── inserts ──────────────────────────────────────────────────────────────

  /**
   * `async` matters on both: stamping throws when the context is missing or
   * disagrees, and a Promise-returning method must reject rather than throw
   * synchronously, or a caller's `.catch()` never sees it.
   */
  override async createOne(data: TenantScopedInput<T>): Promise<Doc<T>> {
    return super.createOne(this.stamped(data));
  }

  override async createMany(data: TenantScopedInput<T>[]): Promise<Doc<T>[]> {
    return super.createMany(data.map((item) => this.stamped(item)));
  }

  /**
   * An explicit `tenantId` is allowed only when it agrees with the context — a
   * mismatch is a bug, and silently overwriting it would hide it.
   */
  private stamped(data: TenantScopedInput<T>): Partial<T> {
    const tenantId = this.tenantId;
    // The casts are the price of Omit over a generic parameter: TypeScript
    // cannot prove Omit<Partial<T>, 'tenantId'> widens back to Partial<T>. Both
    // are confined to this method.
    const supplied = (data as Partial<T>).tenantId;

    if (supplied && supplied !== tenantId) {
      throw new Error(
        `${this.label}.create was given tenantId "${supplied}" while the ` +
          `current context is "${tenantId}"; refusing to write across tenants.`,
      );
    }

    return { ...data, tenantId } as Partial<T>;
  }

  // ── the two named doors out ──────────────────────────────────────────────

  /**
   * A view pinned to an explicit tenant, for code with no CLS context.
   */
  forTenant(tenantId: string): this {
    const pinned = Object.create(this) as this;
    Object.defineProperty(pinned, 'tenantId', { get: () => tenantId });
    return pinned;
  }

  /**
   * A view with the confinement lifted, for genuinely global work — a
   * platform-admin report, a backfill spanning every tenant.
   *
   * Reads and filtered writes stop being scoped. Inserts are deliberately not
   * relaxed: a document must belong to some tenant, so `createOne` still stamps
   * from context and still refuses without one.
   *
   * The repository cannot check that the caller has the authority to do this — it
   * knows nothing about roles — so that guard belongs in the use case. What this
   * method provides is the name that makes the audit possible.
   */
  acrossTenants(): this {
    const unscoped = Object.create(this) as this;
    Object.defineProperty(unscoped, 'scoped', {
      value: (filter: FilterQuery<T> = {}) => filter,
    });
    return unscoped;
  }
}
