import { Injectable } from '@nestjs/common';
import { getModelForClass } from '@typegoose/typegoose';
import { Connection, FilterQuery, Types } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { TenantScopedRepository } from '@/shared/tenant-scoped.repository';
import {
  CachePrefixEnum,
  CachingService,
} from '@/shared/infra/caching/service';
import { AppClsStore } from '@/shared/infra/cls/module';
import { ConversationModel } from '../models/conversation.model';

/**
 * What a caller needs to decide whether a message may be posted: does the
 * conversation exist within this tenant, and who is in it.
 *
 * A projection rather than the document, for two reasons that now agree. It is all
 * a caller needs, so there is no point loading more. And it is what the cache
 * accepts: `CachingService` takes only what JSON can express, so handing it a
 * hydrated document is a compile error rather than an `_id` that silently returns
 * a string and gets written back to MongoDB as one.
 */
export type ConversationSummary = {
  id: string;
  participantIds: string[];
};

/**
 * Long enough to absorb a burst of messages into one conversation, short enough
 * that a future participant change cannot linger.
 *
 * Nothing mutates a conversation today — there is no endpoint that adds or
 * removes a participant — so this cache cannot currently go stale.
 *
 * Whoever adds one should know that **deleting this key is not sufficient**. A
 * read that missed just before the change is still running its loader; when it
 * returns it writes the value it fetched, which lands *after* the delete and
 * restores the stale entry for a full TTL. Demonstrated against a real Redis: a
 * removed participant survived in the cache for the whole minute.
 *
 * The cheap fix is a versioned key — fold a counter that the mutation bumps into
 * the key, so the in-flight write lands on a name nobody reads any more. Deleting
 * plus a short TTL narrows the window but does not close it; anything stronger
 * (a generation check on write, a lock) costs more than this data is worth.
 */
const CONVERSATION_SUMMARY_TTL_MS = 60_000;

@Injectable()
export class ConversationRepository extends TenantScopedRepository<ConversationModel> {
  constructor(
    connection: Connection,
    cls: ClsService<AppClsStore>,
    private readonly cachingService: CachingService,
  ) {
    super(
      getModelForClass(ConversationModel, { existingConnection: connection }),
      cls,
    );
  }

  /**
   * Scoped by construction: a conversation belonging to another tenant is
   * indistinguishable from one that does not exist.
   */
  findByIdInTenant(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return Promise.resolve(null);
    }

    return this.findOne({ _id: new Types.ObjectId(id) });
  }

  /**
   * The conversations this caller is in, newest first, one keyset page at a time.
   *
   * Participation is filtered in the query, not after it: a page of twenty that
   * then drops the ones you may not see is a page of four, and nothing tells the
   * caller the difference between that and there being only four.
   *
   * Ordered by `createdAt`, not by last activity. A messenger normally sorts by the
   * newest message, which needs a `lastMessageAt` this model deliberately does not
   * carry — dropped in M3.4 because nothing read it. Something reads it now, so it
   * is a real candidate again; it stays out of this change because maintaining it
   * is an extra write on the hottest path in the product, and that deserves its own
   * decision rather than arriving as a side effect of a list endpoint.
   *
   * Backed by `tenant_participant_createdAt_id` — see the migration. Without it
   * this is a collection scan followed by an in-memory sort.
   */
  pageByParticipant(query: {
    participantId: string;
    limit: number;
    before?: { createdAt: Date; id: string };
  }) {
    const filter: FilterQuery<ConversationModel> = {
      participantIds: query.participantId,
    };

    if (query.before) {
      // The full sort key, so two conversations created in the same millisecond
      // are neither repeated nor skipped across a page break.
      const { createdAt, id } = query.before;
      filter.$or = [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: new Types.ObjectId(id) } },
      ];
    }

    return this.find(filter, {
      sort: { createdAt: -1, _id: -1 },
      limit: query.limit,
    });
  }

  /**
   * The cached form of the lookup above, for the paths that run on every message.
   *
   * `POST /api/v1/messages` is the hottest endpoint in the product and it opens
   * with this read, so in a busy conversation MongoDB answers the same question
   * hundreds of times a minute with the same answer.
   *
   * **The key carries the tenant, and it is taken from `this.tenantId`** — the
   * same CLS-derived value every query on this class is scoped by, which throws
   * rather than falling back when absent. A key built by the caller could omit it,
   * and a cache that omits it hands one tenant another's conversation. That is the
   * whole reason this method is on the repository and not in a use case.
   *
   * A miss is not cached: `getOrSet` stores nothing for a nil result, so a
   * conversation created a moment after someone asked for it is visible at once
   * rather than 404ing until the entry expires.
   */
  async findCachedSummaryInTenant(
    id: string,
  ): Promise<ConversationSummary | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return this.cachingService.getOrSet<ConversationSummary | null>({
      key: this.cachingService.withPrefix(
        CachePrefixEnum.Conversation,
        `${this.tenantId}:${id}`,
      ),
      ttl: CONVERSATION_SUMMARY_TTL_MS,
      fn: async () => {
        const conversation = await this.findByIdInTenant(id);

        return conversation
          ? {
              id: conversation._id.toString(),
              participantIds: conversation.participantIds,
            }
          : null;
      },
    });
  }
}
