import { Types } from 'mongoose';

/**
 * Keyset (cursor) pagination — see ADR-004.
 *
 * The cursor is an opaque base64 string carrying the sort tuple of the last item
 * returned. Keeping it opaque is what lets the Mongo-backed list and the
 * Elasticsearch-backed search present the same contract while sorting on
 * entirely different things underneath.
 *
 * There is deliberately no `page` and no exact `total`: an exact count over a
 * keyset query is a second, unbounded scan, and no chat UI displays one.
 */
export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Approximate, and only supplied by search. Never exact — see ADR-004. */
  total?: number;
};

export type TimeCursor = {
  timestamp: string;
  id: string;
};

export const encodeCursor = (cursor: unknown): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeCursor = <T>(cursor: string | undefined): T | null => {
  if (!cursor) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
};

export const encodeTimeCursor = (item: {
  timestamp: Date;
  _id: Types.ObjectId;
}): string =>
  encodeCursor({
    timestamp: item.timestamp.toISOString(),
    id: item._id.toString(),
  } satisfies TimeCursor);

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
