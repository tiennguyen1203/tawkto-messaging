import { modelOptions, prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { TenantScopedModel } from './base.model';

/**
 * Pinned rather than derived from the class name. Typegoose would otherwise
 * pluralise `MessageModel` into `messagemodels`, and renaming the class would
 * silently repoint the application at a new, index-less collection while the
 * migrations kept building indexes on the old one.
 */
export const MESSAGES_COLLECTION = 'messages';

/**
 * Indexes for this collection live in `migrations/`, not here — see ADR-005.
 * Current: { tenantId: 1, conversationId: 1, timestamp: -1, _id: -1 }, which
 * serves the keyset-paginated conversation listing.
 */
@modelOptions({ schemaOptions: { collection: MESSAGES_COLLECTION } })
export class MessageModel extends TenantScopedModel {
  @prop({ required: true, type: () => Types.ObjectId })
  conversationId!: Types.ObjectId;

  @prop({ required: true, type: () => String })
  senderId!: string;

  @prop({ required: true, type: () => String })
  content!: string;

  /**
   * The domain timestamp from the brief, assigned by the server. Distinct from
   * `createdAt`: they coincide today, but `timestamp` is what the API and the
   * sort order are defined against, and it is the field the index is built on.
   */
  @prop({ required: true, type: () => Date })
  timestamp!: Date;

  @prop({ type: () => Object })
  metadata?: Record<string, unknown>;
}
