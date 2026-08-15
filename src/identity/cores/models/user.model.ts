import { modelOptions, prop } from '@typegoose/typegoose';

import { TenantScopedModel } from '@/shared/models/base.model';

/** Pinned, not derived from the class name — see MESSAGES_COLLECTION. */
export const USERS_COLLECTION = 'users';

/**
 * A person who belongs to exactly one tenant and can be issued a token.
 *
 * There is no password. This context issues a token to whoever asks for one by
 * name — see the note in `identity/common/routes.config.ts`.
 */
@modelOptions({ schemaOptions: { collection: USERS_COLLECTION } })
export class UserModel extends TenantScopedModel {
  @prop({ required: true, type: () => String })
  email!: string;

  @prop({ required: true, type: () => String })
  displayName!: string;

  @prop({ required: true, type: () => [String], default: [] })
  roles!: string[];
}
