import { Injectable } from '@nestjs/common';
import { getModelForClass } from '@typegoose/typegoose';
import { Connection, FilterQuery, Types } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { Doc } from '@/shared/base.repository';
import { TenantScopedRepository } from '@/shared/tenant-scoped.repository';
import { AppClsStore } from '@/shared/infra/cls/module';
import {
  MessageSearchIndex,
  MessageSearchPage,
} from '@/messaging/infra/elasticsearch/message-search.index';
import { MessageModel } from '../models/message.model';

export type MessageSearchRequest = {
  conversationId: string;
  /** The text to match against message content. */
  text: string;
  limit: number;
  cursor?: string;
};

export type MessagePageQuery = {
  conversationId: string;
  limit: number;
  /** Exclusive upper bound: return messages strictly older than this point. */
  before?: { timestamp: Date; id: string };
};

@Injectable()
export class MessageRepository extends TenantScopedRepository<MessageModel> {
  constructor(
    connection: Connection,
    cls: ClsService<AppClsStore>,
    private readonly searchIndex: MessageSearchIndex,
  ) {
    super(
      getModelForClass(MessageModel, { existingConnection: connection }),
      cls,
    );
  }

  /**
   * Keyset pagination — see ADR-004.
   *
   * The filter and sort deliberately mirror the compound index
   * { tenantId, conversationId, timestamp: -1, _id: -1 } exactly, so Mongo walks
   * the index and never sorts in memory, whatever the page depth.
   */
  async pageByConversation(
    query: MessagePageQuery,
  ): Promise<Doc<MessageModel>[]> {
    const filter: FilterQuery<MessageModel> = {
      conversationId: new Types.ObjectId(query.conversationId),
    };

    if (query.before) {
      // Compare on the full sort key, not just the timestamp: messages sharing a
      // timestamp would otherwise be skipped or repeated across the page break.
      const { timestamp, id } = query.before;
      filter.$or = [
        { timestamp: { $lt: timestamp } },
        { timestamp, _id: { $lt: new Types.ObjectId(id) } },
      ];
    }

    return this.find(filter, {
      sort: { timestamp: -1, _id: -1 },
      limit: query.limit,
    });
  }

  /**
   * Full-text search over the same messages, served by Elasticsearch.
   *
   * Here rather than on the index itself so that reading messages goes through
   * one door whichever store answers, and so the tenant is applied the way it is
   * everywhere else — inherited from the repository, not remembered by the
   * caller. Before this, the use case read `tenantId` out of CLS and re-derived
   * the guard `tenantId` below already performs.
   *
   * **These results are eventually consistent.** Every other method on this class
   * reads MongoDB, which is authoritative and current. This one reads a copy the
   * CDC consumer maintains: normally about a second behind, and arbitrarily far
   * behind if that consumer is lagging or stopped. A message that
   * `pageByConversation` returns may not be findable here yet.
   *
   * Writes are not mirrored: the index is filled by the consumer, which runs
   * outside any request and has no tenant in scope to inherit. It talks to
   * `MessageSearchIndex` directly, the way a migration talks to a collection.
   */
  async search(request: MessageSearchRequest): Promise<MessageSearchPage> {
    return this.searchIndex.search({
      tenantId: this.tenantId,
      conversationId: request.conversationId,
      text: request.text,
      limit: request.limit,
      cursor: request.cursor,
    });
  }
}
