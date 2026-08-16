<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  createTenant,
  createUser,
  issueToken,
  listTenants,
  listUsers,
  type Tenant,
  type User,
} from '@/api/identity';
import { useRequest } from '@/api/use-request';
import BaseButton from '@/components/BaseButton.vue';
import BaseInput from '@/components/BaseInput.vue';
import BaseSelect from '@/components/BaseSelect.vue';
import { useSession } from '@/session/use-session';

/**
 * Who you are, top right, where an account menu lives in every product anybody has
 * used. Switching users is the single most repeated action in this demo — proving
 * that two people see different things is most of the point — so it belongs one
 * click away rather than on a page of its own.
 *
 * It also carries the seeding: making a tenant or a user is the same errand as
 * choosing one, and splitting them across two places means walking back and forth.
 */
const session = useSession();

const open = ref(false);
const tenants = useRequest(listTenants);
const users = useRequest(() => listUsers(tenantId.value));

const tenantId = ref('');
const userId = ref('');
const newTenant = ref('');
const newUserName = ref('');
const busy = ref<'tenant' | 'user' | 'token' | undefined>();
const failure = ref<string>();

const tenantOptions = computed(() =>
  (tenants.data.value ?? []).map((item: Tenant) => ({
    value: item.id,
    label: item.name,
  })),
);

const userOptions = computed(() =>
  (users.data.value ?? []).map((item: User) => ({
    value: item.id,
    label: item.displayName,
    detail: item.email,
  })),
);

/** The two initials a chat product puts in a circle. */
const initials = computed(() => {
  const name = session.user.value?.displayName ?? '';
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
});

onMounted(() => void tenants.run());

watch(tenantId, (next) => {
  userId.value = '';
  users.data.value = undefined;
  session.selectTenant((tenants.data.value ?? []).find((t: Tenant) => t.id === next));
  if (next) {
    void users.run();
  }
});

/**
 * Adding a user selects them, and selecting them issues a token — but adding is
 * usually followed by adding another, so the panel stays open for that one. Closing
 * it under the hand that just typed a name is how you end up reopening it twice to
 * seed two people.
 *
 * Consumed by the watcher rather than reset by the caller: the watcher runs a tick
 * later, so a `finally` in `addUser` would clear the flag before it was read.
 */
let stayOpenOnce = false;

/**
 * Choosing a user issues their token immediately. A separate "issue" button is an
 * extra click that can only ever be answered one way, and a chosen user without a
 * token is a state where the sidebar is empty for no visible reason.
 */
watch(userId, async (next) => {
  const shouldClose = !stayOpenOnce;
  stayOpenOnce = false;

  const user = (users.data.value ?? []).find((u: User) => u.id === next);
  session.selectUser(user);
  if (!user) {
    return;
  }

  busy.value = 'token';
  failure.value = undefined;
  try {
    const issued = await issueToken(user.id);
    session.setToken(issued.accessToken);
    if (shouldClose) {
      open.value = false;
    }
  } catch (thrown) {
    failure.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    busy.value = undefined;
  }
});

const addTenant = async (): Promise<void> => {
  busy.value = 'tenant';
  failure.value = undefined;
  try {
    const created = await createTenant(newTenant.value);
    newTenant.value = '';
    await tenants.run();
    tenantId.value = created.id;
  } catch (thrown) {
    failure.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    busy.value = undefined;
  }
};

const addUser = async (): Promise<void> => {
  busy.value = 'user';
  failure.value = undefined;
  try {
    const name = newUserName.value.trim();
    const created = await createUser({
      tenantId: tenantId.value,
      // Derived rather than asked for: an email is a second field to fill in for a
      // demo that never sends one, and uniqueness within the tenant is all it needs
      // to satisfy.
      email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@${tenantId.value.slice(-6)}.test`,
      displayName: name,
      roles: ['user'],
    });
    newUserName.value = '';
    await users.run();
    stayOpenOnce = true;
    userId.value = created.id;
  } catch (thrown) {
    failure.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    busy.value = undefined;
  }
};
</script>

<template>
  <div class="switcher">
    <button
      class="chip"
      type="button"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span class="avatar" aria-hidden="true">{{ initials }}</span>
      <span class="who">
        <span class="name">{{ session.user.value?.displayName ?? 'Choose a user' }}</span>
        <span class="tenant">{{ session.tenant.value?.name ?? 'no tenant' }}</span>
      </span>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      </svg>
    </button>

    <!--
      A plain panel, not a modal: it takes no focus trap and dismisses by clicking
      the chip again or the backdrop. A dialog would be heavier than the job and
      would fight the keyboard for no benefit.
    -->
    <div v-if="open" class="backdrop" @click="open = false" />

    <div v-if="open" class="panel" role="dialog" aria-label="Switch identity">
      <BaseSelect
        v-model="tenantId"
        label="Tenant"
        placeholder="Choose a tenant…"
        :options="tenantOptions"
        :hint="tenants.error.value"
      />

      <form class="inline" @submit.prevent="addTenant">
        <BaseInput v-model="newTenant" class="grow" label="New tenant" placeholder="Acme Corp" />
        <BaseButton type="submit" :loading="busy === 'tenant'" :disabled="!newTenant.trim()">
          Add
        </BaseButton>
      </form>

      <hr />

      <BaseSelect
        v-model="userId"
        label="Act as"
        :placeholder="tenantId ? 'Choose a user…' : 'Choose a tenant first'"
        :options="userOptions"
        :disabled="!tenantId"
      />

      <form class="inline" @submit.prevent="addUser">
        <BaseInput
          v-model="newUserName"
          class="grow"
          label="New user"
          placeholder="Alice"
          :disabled="!tenantId"
        />
        <BaseButton
          type="submit"
          :loading="busy === 'user'"
          :disabled="!tenantId || !newUserName.trim()"
        >
          Add
        </BaseButton>
      </form>

      <p v-if="failure" class="failure" role="alert">{{ failure }}</p>

      <p class="note">
        Choosing a user takes their token straight away. Nothing is stored — a reload
        asks again.
      </p>
    </div>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
}

.chip {
  /* Above the backdrop, or the backdrop swallows the click that is supposed to
     close the panel — the chip looks enabled and does nothing. Caught by a test
     timing out on it, not by reading the code that claimed it worked. */
  position: relative;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.chip:hover {
  border-color: var(--border-strong);
}

.avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 600;
}

.who {
  display: grid;
  text-align: left;
  line-height: 1.2;
}

.name {
  font-size: 13px;
  font-weight: 500;
}

.tenant {
  font-size: 11px;
  color: var(--muted);
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}

.panel {
  position: absolute;
  z-index: 11;
  top: calc(100% + 8px);
  right: 0;
  width: min(340px, calc(100vw - 32px));
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
}

.inline {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
}

.grow {
  flex: 1;
}

hr {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.note,
.failure {
  margin: 0;
  font-size: 12px;
}

.note {
  color: var(--muted);
}

.failure {
  color: var(--danger);
  overflow-wrap: anywhere;
}
</style>
