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
import AsyncPanel from '@/components/AsyncPanel.vue';
import BaseBadge from '@/components/BaseBadge.vue';
import BaseButton from '@/components/BaseButton.vue';
import BaseCard from '@/components/BaseCard.vue';
import BaseInput from '@/components/BaseInput.vue';
import BaseSelect from '@/components/BaseSelect.vue';
import CopyableValue from '@/components/CopyableValue.vue';
import { useSession } from '@/session/use-session';

/**
 * Become somebody: pick a tenant, pick one of its users, take their token.
 *
 * The page owns the requests and the forms; it owns no styling and no state beyond
 * what is on screen. Who you are ends up in `useSession`, which the messaging pane
 * reads.
 */
const session = useSession();

const tenants = useRequest(listTenants);
const tenantId = ref('');

const users = useRequest(() => listUsers(tenantId.value));
const userId = ref('');

const newTenantName = ref('');
const newUserEmail = ref('');
const newUserName = ref('');

const creatingTenant = ref(false);
const creatingUser = ref(false);
const issuing = ref(false);
const actionError = ref<string>();

const tenantOptions = computed(() =>
  (tenants.data.value ?? []).map((item) => ({
    value: item.id,
    label: item.name,
    detail: item.id,
  })),
);

const userOptions = computed(() =>
  (users.data.value ?? []).map((item) => ({
    value: item.id,
    label: item.displayName,
    detail: item.email,
  })),
);

const found = <T extends { id: string }>(items: T[] | undefined, id: string) =>
  (items ?? []).find((item) => item.id === id);

/**
 * One place turns a rejection into a message, because there are five buttons here
 * and five copies of the same `try`/`catch` is five chances to swallow one.
 */
const attempt = async (
  flag: { value: boolean },
  action: () => Promise<void>,
): Promise<void> => {
  flag.value = true;
  actionError.value = undefined;

  try {
    await action();
  } catch (thrown) {
    actionError.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    flag.value = false;
  }
};

onMounted(() => void tenants.run());

// Selecting a tenant is what makes its users askable — and what invalidates any
// user and token already chosen. The session drops both; this drops the local
// selection so the form and the session cannot disagree.
watch(tenantId, (next) => {
  userId.value = '';
  users.data.value = undefined;
  session.selectTenant(found<Tenant>(tenants.data.value, next));

  if (next) {
    void users.run();
  }
});

watch(userId, (next) => {
  session.selectUser(found<User>(users.data.value, next));
});

const onCreateTenant = () =>
  attempt(creatingTenant, async () => {
    const created = await createTenant(newTenantName.value);
    newTenantName.value = '';
    await tenants.run();
    // Selecting it is the next thing anyone would do, and the watcher above then
    // loads its (empty) user list, which is where the "create a user" hint lives.
    tenantId.value = created.id;
  });

const onCreateUser = () =>
  attempt(creatingUser, async () => {
    const created = await createUser({
      tenantId: tenantId.value,
      email: newUserEmail.value,
      displayName: newUserName.value,
      roles: ['user'],
    });
    newUserEmail.value = '';
    newUserName.value = '';
    await users.run();
    userId.value = created.id;
  });

const onIssueToken = () =>
  attempt(issuing, async () => {
    const issued = await issueToken(userId.value);
    session.setToken(issued.accessToken);
  });
</script>

<template>
  <div class="stack">
    <BaseCard title="Tenant">
      <AsyncPanel
        :pending="tenants.pending.value"
        :error="tenants.error.value"
        :empty="tenants.data.value?.length === 0"
        empty-message="No tenants yet."
        empty-hint="Create one below — messaging provisions its search alias from the event."
        @retry="tenants.run()"
      >
        <BaseSelect
          v-model="tenantId"
          label="Act inside"
          placeholder="Choose a tenant…"
          :options="tenantOptions"
        />
      </AsyncPanel>

      <form class="row" @submit.prevent="onCreateTenant">
        <BaseInput
          v-model="newTenantName"
          class="grow"
          label="New tenant"
          placeholder="Acme Corp"
        />
        <BaseButton
          type="submit"
          variant="secondary"
          :loading="creatingTenant"
          :disabled="!newTenantName.trim()"
        >
          Create tenant
        </BaseButton>
      </form>
    </BaseCard>

    <BaseCard title="User">
      <p v-if="!tenantId" class="muted hint">Choose a tenant first.</p>

      <template v-else>
        <AsyncPanel
          :pending="users.pending.value"
          :error="users.error.value"
          :empty="users.data.value?.length === 0"
          empty-message="This tenant has no users."
          empty-hint="Create one below to get a token."
          @retry="users.run()"
        >
          <BaseSelect
            v-model="userId"
            label="Act as"
            placeholder="Choose a user…"
            :options="userOptions"
          />
        </AsyncPanel>

        <form class="row" @submit.prevent="onCreateUser">
          <BaseInput
            v-model="newUserName"
            class="grow"
            label="Display name"
            placeholder="Alice"
          />
          <BaseInput
            v-model="newUserEmail"
            class="grow"
            label="Email"
            type="email"
            placeholder="alice@acme.test"
          />
          <BaseButton
            type="submit"
            variant="secondary"
            :loading="creatingUser"
            :disabled="!newUserName.trim() || !newUserEmail.trim()"
          >
            Create user
          </BaseButton>
        </form>
      </template>
    </BaseCard>

    <BaseCard title="Session">
      <template #actions>
        <BaseButton v-if="session.isReady.value" variant="ghost" @click="session.clear()">
          Sign out
        </BaseButton>
      </template>

      <div class="row">
        <BaseBadge :tone="session.tenant.value ? 'accent' : 'neutral'">
          tenant: {{ session.tenant.value?.name ?? 'none' }}
        </BaseBadge>
        <BaseBadge :tone="session.user.value ? 'accent' : 'neutral'">
          user: {{ session.user.value?.displayName ?? 'none' }}
        </BaseBadge>
        <BaseBadge :tone="session.isReady.value ? 'success' : 'neutral'">
          token: {{ session.isReady.value ? 'held' : 'none' }}
        </BaseBadge>
      </div>

      <BaseButton
        v-if="!session.isReady.value"
        variant="primary"
        :loading="issuing"
        :disabled="!userId"
        @click="onIssueToken"
      >
        Issue token
      </BaseButton>

      <CopyableValue
        v-else
        :value="session.token.value ?? ''"
        label="Bearer"
        secret
      />

      <p class="muted hint">
        Held in memory only — a reload asks you to pick again. These endpoints issue a
        token for anyone who is named, so one that outlives the page is one nobody
        meant to keep.
      </p>

      <p v-if="actionError" class="error-text" role="alert">{{ actionError }}</p>
    </BaseCard>
  </div>
</template>

<style scoped>
.row {
  align-items: flex-end;
}

/* Inputs take the room; the button keeps its own width. */
.grow {
  flex: 1 1 12rem;
}

.hint {
  margin: 0;
  font-size: 13px;
}

.error-text {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
  overflow-wrap: anywhere;
}
</style>
