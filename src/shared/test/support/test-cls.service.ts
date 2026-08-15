import { AppClsStore } from '@/shared/infra/cls/module';

/**
 * A ClsService stand-in backed by a plain object.
 *
 * The real ClsService is driven by AsyncLocalStorage, which does not survive the
 * hop between jest's `beforeEach` and `it` frames reliably. Since what we want to
 * assert is that repositories read the tenant from CLS — not that
 * AsyncLocalStorage works — a plain store is both simpler and more deterministic.
 */
export class TestClsService {
  private store: Partial<AppClsStore> = {};

  isActive(): boolean {
    return true;
  }

  get(): Partial<AppClsStore>;
  get<K extends keyof AppClsStore>(key: K): AppClsStore[K];
  get(key?: keyof AppClsStore) {
    return key ? this.store[key] : this.store;
  }

  set<K extends keyof AppClsStore>(key: K, value: AppClsStore[K]) {
    this.store[key] = value;
  }

  reset() {
    this.store = {};
  }
}
