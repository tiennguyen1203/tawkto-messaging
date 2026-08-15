import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { isNil } from 'lodash';

/**
 * Anything JSON can express, and nothing else.
 *
 * The store round-trips values through JSON, so a `Date` comes back a string and a
 * `Map`, a `Set`, an `ObjectId`, a `Buffer` or a class instance comes back as
 * something that is not what went in. Left to a plain `<T>` the signature would be
 * a lie — it promises a `T` and returns `JSON.parse(JSON.stringify(T))` — and the
 * lie is invisible in tests, which run against an in-memory store that does **not**
 * serialise. A value that only works because it skipped JSON passes every spec and
 * fails in production.
 *
 * So the constraint is the fix: what cannot survive the round trip cannot be
 * written in the first place. `cache.set(key, { createdAt: new Date() })` is a
 * compile error at the call site, naming the field, and the author converts it
 * once and deliberately — to epoch milliseconds or an ISO string — rather than
 * discovering months later that a timestamp became a string somewhere downstream.
 *
 * `undefined` is permitted for optional properties. JSON drops the key entirely,
 * which for an optional property is indistinguishable from it being absent.
 */
export type Cacheable =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Cacheable[]
  | { readonly [key: string]: Cacheable };

@Injectable()
export class CachingService {
  /**
   * Misses currently being resolved, so concurrent callers for one key share a
   * single call to `fn` instead of each making their own.
   *
   * Per process, not cluster-wide: N replicas still produce N calls on a cold key.
   * A distributed lock would fix that and is not worth its failure modes here —
   * this collapses the burst that matters, which is the one inside a process whose
   * hot key has just expired.
   *
   * It does **not** make the cache invalidation-safe, and slightly widens the
   * window in which that matters: a `del` that arrives while a loader is running
   * is undone when that loader writes what it had already fetched, and sharing one
   * loader means its result is older relative to more callers. Callers that
   * invalidate need a versioned key, not just a delete.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  withPrefix(prefix: CachePrefixEnum, key: string | number): string {
    return `${prefix}:${key}`;
  }

  async set<T extends Cacheable>(
    key: string,
    value: T,
    ttl: Milliseconds = THIRTY_MINUTES_IN_MILLISECONDS,
  ): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  get<T extends Cacheable>(key: string): Promise<T | undefined> {
    return this.cacheManager.get(key);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  /**
   * Returns the cached value, or computes it once and caches it.
   *
   * Two things are deliberate and easy to get wrong:
   *
   * **A cached value is served whenever one is present** — including `0`, `false`
   * and `''`. Testing the value for truthiness instead, as this did until it was
   * measured, means a counter cached as zero or a flag cached as false recomputes
   * on every call and the cache silently does nothing.
   *
   * **A nil result is not written.** Note what this does and does not buy: since a
   * present value is what counts as a hit, a stored `null` would read back as a
   * miss anyway, so skipping the write changes no answer — it saves a round trip
   * and the memory a useless entry would occupy. Which also means **negative
   * caching is not available**: a caller that genuinely wants to remember an
   * absence must cache a sentinel it can recognise, so that intent is visible at
   * the point it is decided.
   */
  async getOrSet<T extends Cacheable>({
    key,
    fn,
    ttl = THIRTY_MINUTES_IN_MILLISECONDS,
  }: {
    key: string;
    fn: () => T | Promise<T>;
    /**
     * Time to live in milliseconds
     * @example 60000 for 1 minute
     */
    ttl?: Milliseconds;
  }): Promise<T> {
    const cachedData = await this.cacheManager.get<T>(key);
    if (!isNil(cachedData)) {
      return cachedData;
    }

    const alreadyResolving = this.inFlight.get(key);
    if (alreadyResolving) {
      return alreadyResolving as Promise<T>;
    }

    const resolving = (async (): Promise<T> => {
      const data: T = await fn();
      if (!isNil(data)) {
        await this.cacheManager.set(key, data, ttl);
      }
      return data;
    })().finally(() => {
      // Removed however it settled. Left behind after a rejection, one failed
      // lookup would be handed to every caller of this key from then on.
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, resolving);
    return resolving;
  }
}

/**
 * Namespaces for cache keys, so two unrelated things can never collide on one.
 *
 * A key must also carry whatever scopes the value — for anything tenant-owned
 * that means the tenant id, and the caller that builds the key is the wrong place
 * to remember it. See `ConversationRepository.findCachedSummaryInTenant`.
 */
export enum CachePrefixEnum {
  Conversation = 'conversation',
}

export type Milliseconds = number;

const THIRTY_MINUTES_IN_MILLISECONDS = 30 * 60 * 1000;
