import { modelOptions, prop } from '@typegoose/typegoose';
import { TenantScopedModel } from './base.model';

/** Pinned, not derived from the class name — see MESSAGES_COLLECTION. */
export const CONVERSATIONS_COLLECTION = 'conversations';

/**
 * Indexes for this collection live in `migrations/`, not here — see ADR-005.
 * Current: the default `_id` index is enough for M1, which only ever loads a
 * conversation by id within a tenant.
 */
@modelOptions({ schemaOptions: { collection: CONVERSATIONS_COLLECTION } })
export class ConversationModel extends TenantScopedModel {
  @prop({ required: true, type: () => [String], default: [] })
  participantIds!: string[];

  /**
   * Maintained by the CDC consumer in M3 rather than on the write path, so
   * posting a message stays a single insert.
   */
  @prop({ type: () => Date })
  lastMessageAt?: Date;
}
