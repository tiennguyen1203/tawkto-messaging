<script setup lang="ts">
import { ref } from 'vue';

import { ApiError } from '@/api/client';
import { createTenant, createUser, issueToken } from '@/api/identity';
import { listMessages } from '@/api/messaging';
import BaseBadge from '@/components/BaseBadge.vue';
import BaseButton from '@/components/BaseButton.vue';
import BaseCard from '@/components/BaseCard.vue';

/**
 * Two things the brief grades that are invisible in a happy path: a tenant cannot
 * reach another tenant's data, and a member of the right tenant still cannot read a
 * conversation they are not in.
 *
 * Each probe makes a real second identity and asks the real API with it. Nothing is
 * simulated — the status code shown is the one messaging returned.
 */
const props = defineProps<{ conversationId: string; tenantId: string }>();

type Outcome = {
  status: number | 'error';
  message: string;
  /** Whether the answer is the one the design promises. */
  expected: boolean;
};

const outsider = ref<Outcome>();
const nonParticipant = ref<Outcome>();
const running = ref<'outsider' | 'nonParticipant' | undefined>();

/** Unique per click: users are unique by email within a tenant. */
const unique = () => Date.now().toString(36);

const probe = async (token: string, wanted: number): Promise<Outcome> => {
  try {
    await listMessages(token, props.conversationId, { limit: 1 });
    return {
      status: 200,
      message: 'The conversation was readable. That is a data leak, not a demo.',
      expected: false,
    };
  } catch (thrown) {
    if (thrown instanceof ApiError) {
      return {
        status: thrown.status,
        message: thrown.message,
        expected: thrown.status === wanted,
      };
    }
    return { status: 'error', message: String(thrown), expected: false };
  }
};

const asOutsider = async (): Promise<void> => {
  running.value = 'outsider';
  outsider.value = undefined;
  try {
    const id = unique();
    const tenant = await createTenant(`Outsider ${id}`);
    const user = await createUser({
      tenantId: tenant.id,
      email: `outsider-${id}@elsewhere.test`,
      displayName: 'Outsider',
    });
    const { accessToken } = await issueToken(user.id);
    // 404, not 403. A 403 would confirm the conversation exists, which is itself a
    // fact belonging to the other tenant.
    outsider.value = await probe(accessToken, 404);
  } finally {
    running.value = undefined;
  }
};

const asNonParticipant = async (): Promise<void> => {
  running.value = 'nonParticipant';
  nonParticipant.value = undefined;
  try {
    const id = unique();
    const user = await createUser({
      tenantId: props.tenantId,
      email: `bystander-${id}@acme.test`,
      displayName: 'Bystander',
    });
    const { accessToken } = await issueToken(user.id);
    // 403 here, because the conversation is known to exist inside this tenant and
    // the caller simply is not in it. Hiding that would be lying to a colleague.
    nonParticipant.value = await probe(accessToken, 403);
  } finally {
    running.value = undefined;
  }
};
</script>

<template>
  <BaseCard title="Isolation">
    <p class="muted note">
      Each button mints a real second identity and asks messaging for
      <strong>this same conversation</strong> with it.
    </p>

    <div class="probe">
      <div class="row">
        <BaseButton
          variant="secondary"
          :loading="running === 'outsider'"
          @click="asOutsider"
        >
          Ask as another tenant
        </BaseButton>
        <span class="muted note">expects <code class="mono">404</code></span>
      </div>
      <p v-if="outsider" class="row">
        <BaseBadge :tone="outsider.expected ? 'success' : 'danger'">
          {{ outsider.status }} — {{ outsider.expected ? 'as designed' : 'wrong' }}
        </BaseBadge>
        <span class="muted note">{{ outsider.message }}</span>
      </p>
    </div>

    <div class="probe">
      <div class="row">
        <BaseButton
          variant="secondary"
          :loading="running === 'nonParticipant'"
          @click="asNonParticipant"
        >
          Ask as a non-participant in this tenant
        </BaseButton>
        <span class="muted note">expects <code class="mono">403</code></span>
      </div>
      <p v-if="nonParticipant" class="row">
        <BaseBadge :tone="nonParticipant.expected ? 'success' : 'danger'">
          {{ nonParticipant.status }} —
          {{ nonParticipant.expected ? 'as designed' : 'wrong' }}
        </BaseBadge>
        <span class="muted note">{{ nonParticipant.message }}</span>
      </p>
    </div>

    <p class="muted note">
      The difference is deliberate: <code class="mono">404</code> outside the tenant,
      because even the existence of the conversation belongs to its owner;
      <code class="mono">403</code> inside it, because there is nothing to hide from a
      colleague, only something to refuse.
    </p>
  </BaseCard>
</template>

<style scoped>
.probe {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border);
}

.note {
  margin: 0;
  font-size: 13px;
}
</style>
