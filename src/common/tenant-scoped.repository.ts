import { ModelType } from '@typegoose/typegoose/lib/types';
import { FilterQuery } from 'mongoose';
import { ClsService } from 'nestjs-cls';
import { TenantScopedModel } from '@/cores/models/base.model';
import { AppClsStore } from '@/infra/cls/module';
import { BaseRepository } from './base.repository';

/**
 * A repository whose every query is confined to the tenant of the current
 * request.
 *
 * The tenant is read from CLS, which is populated once from the verified JWT —
 * so an attacker cannot reach another tenant's data by putting a `tenantId` in
 * a body, param or query string, and a developer cannot leak it by forgetting a
 * `where` clause. Isolation is a property of the repository, not a discipline
 * applied at each call site.
 *
 * Callers that legitimately span tenants — the CDC consumer, migrations, an
 * admin report — use `forTenant(id)` to state the tenant explicitly. There is
 * deliberately no unscoped escape hatch.
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
   * unscoped query, because every failure mode of a missing tenant is a data
   * leak.
   */
  protected get tenantId(): string {
    const tenantId = this.cls.isActive() ? this.cls.get('tenantId') : undefined;

    if (!tenantId) {
      throw new Error(
        `${this.label} was used outside a tenant context. Use forTenant(tenantId) ` +
          `for work that runs outside a request (consumers, migrations, jobs).`,
      );
    }

    return tenantId;
  }

  protected scoped(
    filter: FilterQuery<T> = {},
    tenantId: string = this.tenantId,
  ): FilterQuery<T> {
    return { ...filter, tenantId } as FilterQuery<T>;
  }

  /**
   * Returns a view of this repository pinned to an explicit tenant, for code
   * that runs outside an HTTP request and therefore has no CLS context.
   */
  forTenant(tenantId: string): this {
    const pinned = Object.create(this) as this;
    Object.defineProperty(pinned, 'tenantId', {
      get: () => tenantId,
    });
    return pinned;
  }
}
