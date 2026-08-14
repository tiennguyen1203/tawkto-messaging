import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * Base for every persistence model.
 *
 * `timestamps: true` lets MongoDB own createdAt/updatedAt rather than having each
 * repository set them by hand, which is where clock drift between callers crept in
 * previously.
 *
 * NOTE: indexes are NOT declared here or on any subclass. They live in `migrations/`
 * and are the single source of truth — see infra/database/database.configuration.ts.
 */
@modelOptions({
  schemaOptions: {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
  options: { allowMixed: Severity.ALLOW },
})
export abstract class BaseModel {
  readonly _id!: Types.ObjectId;

  /** Virtual string form of `_id` — what crosses the API boundary. */
  readonly id!: string;

  @prop()
  readonly createdAt!: Date;

  @prop()
  readonly updatedAt!: Date;
}

/**
 * Base for models that belong to exactly one tenant. Extending this is what makes
 * TenantScopedRepository's automatic scoping type-check.
 */
export abstract class TenantScopedModel extends BaseModel {
  @prop({ required: true, type: () => String })
  tenantId!: string;
}
