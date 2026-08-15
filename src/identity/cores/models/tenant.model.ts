import { modelOptions, prop } from '@typegoose/typegoose';

import { BaseModel } from '@/shared/models/base.model';

/** Pinned, not derived from the class name — see MESSAGES_COLLECTION. */
export const TENANTS_COLLECTION = 'tenants';

/**
 * An organisation whose data is isolated from every other organisation's.
 *
 * Not a `TenantScopedModel`: a tenant is the boundary, so it does not sit inside
 * one. That is also why creating a tenant cannot go through the tenant-scoped
 * repository — at that moment there is no tenant in scope to inherit.
 */
@modelOptions({ schemaOptions: { collection: TENANTS_COLLECTION } })
export class TenantModel extends BaseModel {
  @prop({ required: true, type: () => String })
  name!: string;
}
