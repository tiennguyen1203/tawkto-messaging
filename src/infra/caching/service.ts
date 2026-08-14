import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { isNil } from 'lodash';

@Injectable()
export class CachingService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  withPrefix(prefix: CachePrefixEnum, key: string | number): string {
    return `${prefix}:${key}`;
  }

  async set(
    key: string,
    value: unknown,
    ttl: Milliseconds = THIRTY_MINUTES_IN_MILLISECONDS,
  ): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get(key);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  async getOrSet<T>({
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
    if (cachedData) {
      return cachedData;
    }

    const data: T = await fn();
    if (!isNil(data)) {
      await this.cacheManager.set(key, data, ttl);
    }

    return data;
  }
}

export enum CachePrefixEnum {
  Events = 'events',
  EventsOg = 'events_og',
  EventsByVenue = 'events_by_venue',
}

export type Milliseconds = number;

const THIRTY_MINUTES_IN_MILLISECONDS = 30 * 60 * 1000;
