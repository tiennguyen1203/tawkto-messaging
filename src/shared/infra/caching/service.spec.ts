import { createCache } from 'cache-manager';
import { Types } from 'mongoose';

import { CachePrefixEnum, CachingService } from './service';

/**
 * Compile-time assertions, never executed.
 *
 * `@ts-expect-error` is itself an error when the line below it compiles cleanly,
 * so widening `Cacheable` to admit any of these fails `pnpm typecheck`. That is
 * the point: the round-trip hazard is caught by the compiler at the call site, and
 * this is what stops the guard being quietly removed.
 */
const _rejectedByTheCompiler = (cache: CachingService) => {
  // @ts-expect-error a Date comes back from JSON as a string
  void cache.set('k', new Date());

  // @ts-expect-error so does a Date nested in an object
  void cache.set('k', { createdAt: new Date() });

  // @ts-expect-error an ObjectId comes back as a string, and would be written to
  // MongoDB as one — the failure that made this constraint necessary
  void cache.set('k', { _id: new Types.ObjectId() });

  // @ts-expect-error a Map comes back as {}
  void cache.set('k', new Map([['a', 1]]));

  // @ts-expect-error a class instance loses everything but its own enumerable fields
  void cache.getOrSet({ key: 'k', fn: () => new Types.ObjectId() });

  // Plain data is the whole point, and must keep compiling.
  void cache.getOrSet({
    key: 'k',
    fn: () => ({ id: 'x', participantIds: ['alice'], count: 0, ok: true }),
  });
};
void _rejectedByTheCompiler;

describe('@infra/caching/service', () => {
  let cachingService: CachingService;

  beforeEach(() => {
    cachingService = new CachingService(createCache());
  });

  describe('#getOrSet', () => {
    describe('when the value is not cached yet', () => {
      it('should compute it, return it, and serve the next call from the cache', async () => {
        const fn = jest.fn().mockResolvedValue({ answer: 42 });

        expect(await cachingService.getOrSet({ key: 'k', fn })).toEqual({
          answer: 42,
        });
        expect(await cachingService.getOrSet({ key: 'k', fn })).toEqual({
          answer: 42,
        });

        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    describe('when the cached value is falsy', () => {
      // Testing truthiness instead of presence is the classic version of this
      // bug: the cache appears to work, and silently does nothing for exactly the
      // values a counter or a flag takes.
      it.each([
        ['zero', 0],
        ['false', false],
        ['an empty string', ''],
      ])(
        'should serve %s from the cache rather than recomputing',
        async (_label, value) => {
          const fn = jest.fn().mockResolvedValue(value);

          await cachingService.getOrSet({ key: 'k', fn });
          const second = await cachingService.getOrSet({ key: 'k', fn });

          expect(second).toEqual(value);
          expect(fn).toHaveBeenCalledTimes(1);
        },
      );
    });

    describe('when the result is nil', () => {
      it('should not spend a write on it', async () => {
        // The only observable consequence: a stored null would read back as a
        // miss regardless, so this saves a round trip rather than changing an
        // answer. Asserted on the store because nothing else can see it.
        const store = createCache();
        const set = jest.spyOn(store, 'set');
        const service = new CachingService(store);

        await service.getOrSet({ key: 'k', fn: () => null });

        expect(set).not.toHaveBeenCalled();
      });

      it('should return the value as soon as it exists', async () => {
        const fn = jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ created: true });

        expect(await cachingService.getOrSet({ key: 'k', fn })).toBeNull();
        expect(await cachingService.getOrSet({ key: 'k', fn })).toEqual({
          created: true,
        });
      });
    });

    describe('when several callers miss the same key at once', () => {
      it('should compute it once and hand every caller that result', async () => {
        // The stampede this exists to prevent: a hot key expires and every
        // in-flight request queries the database simultaneously — the moment the
        // cache is supposed to be helping most.
        // Resolving on a timer rather than by hand: every caller has to reach
        // `fn` before the first result lands, which is the whole scenario.
        const fn = jest
          .fn()
          .mockImplementation(
            () =>
              new Promise((resolve) =>
                setTimeout(() => resolve({ answer: 42 }), 10),
              ),
          );

        const callers = Promise.all(
          Array.from({ length: 20 }, () =>
            cachingService.getOrSet({ key: 'k', fn }),
          ),
        );

        expect(await callers).toEqual(
          Array.from({ length: 20 }, () => ({ answer: 42 })),
        );
        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    describe('when the computation rejects', () => {
      it('should reject and let the next caller try again', async () => {
        // A rejected promise left in the in-flight map would be handed to every
        // future caller of that key, turning one failed lookup into a permanent one.
        const fn = jest
          .fn()
          .mockRejectedValueOnce(new Error('database is down'))
          .mockResolvedValueOnce({ answer: 42 });

        await expect(cachingService.getOrSet({ key: 'k', fn })).rejects.toThrow(
          'database is down',
        );

        expect(await cachingService.getOrSet({ key: 'k', fn })).toEqual({
          answer: 42,
        });
        expect(fn).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('#withPrefix', () => {
    describe('when building a key', () => {
      it('should namespace it so unrelated values cannot collide', () => {
        expect(
          cachingService.withPrefix(CachePrefixEnum.Conversation, 'abc'),
        ).toBe('conversation:abc');
      });
    });
  });
});
