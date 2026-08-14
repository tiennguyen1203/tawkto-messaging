import { Injectable } from '@nestjs/common';
import { getModelForClass } from '@typegoose/typegoose';
import { Connection, FilterQuery, Types } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { Doc } from '@/common/base.repository';
import { TenantScopedRepository } from '@/common/tenant-scoped.repository';
import { AppClsStore } from '@/infra/cls/module';
import { MessageModel } from '../models/message.model';

export type MessagePageQuery = {
  conversationId: string;
  limit: number;
  /** Exclusive upper bound: return messages strictly older than this point. */
  before?: { timestamp: Date; id: string };
};

@Injectable()
export class MessageRepository extends TenantScopedRepository<MessageModel> {
  constructor(connection: Connection, cls: ClsService<AppClsStore>) {
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
}
