import { computed, readonly, ref } from 'vue';

import type { Tenant, User } from '@/api/identity';

/**
 * Who the demo is currently acting as.
 *
 * Module-level state rather than Pinia: there is one of these, it holds three
 * values, and a store library would be a dependency to explain rather than a
 * problem solved. It is shared by import, so the picker sets it and the messaging
 * pane reads it without either knowing about the other.
 *
 * **In memory only, deliberately.** Nothing here is written to `localStorage` or a
 * cookie. These endpoints issue a token for any user who is named, without checking
 * a credential, and a token that survives a page reload is a token that outlives the
 * demonstration it was made for. Reloading and having to pick again is the point:
 * it makes the token's lifetime visible.
 */
const tenant = ref<Tenant>();
const user = ref<User>();
const token = ref<string>();

export const useSession = () => ({
  // Read-only to callers: state that anything can assign to is state whose changes
  // cannot be traced back to a cause. The three functions below are the only way in.
  tenant: readonly(tenant),
  user: readonly(user),
  token: readonly(token),

  /** True once there is a token — which is what messaging actually requires. */
  isReady: computed(() => Boolean(token.value)),

  /**
   * Choosing a tenant drops the user and the token with it. They belonged to the
   * old tenant, and a token carrying a `tenantId` that no longer matches what the
   * page is showing is the single most confusing state this tool could be in.
   */
  selectTenant: (next: Tenant | undefined): void => {
    tenant.value = next;
    user.value = undefined;
    token.value = undefined;
  },

  /** Same reasoning one level down: a token names a user, so changing user voids it. */
  selectUser: (next: User | undefined): void => {
    user.value = next;
    token.value = undefined;
  },

  setToken: (next: string): void => {
    token.value = next;
  },

  clear: (): void => {
    tenant.value = undefined;
    user.value = undefined;
    token.value = undefined;
  },
});
