<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { listUsers, type User } from '@/api/identity';
import type { Conversation } from '@/api/messaging';
import { useRequest } from '@/api/use-request';
import { useSession } from '@/session/use-session';
import ChatThread from './ChatThread.vue';
import ConversationList from './ConversationList.vue';
import IsolationProbes from './IsolationProbes.vue';

/**
 * The messenger: chats on the left, the conversation on the right.
 *
 * The page holds only what both halves need — which conversation is open, and the
 * names to put on ids. Everything else belongs to the two components.
 */
const session = useSession();

const selected = ref<Conversation>();

const users = useRequest(() => listUsers(session.tenant.value?.id ?? ''));

/**
 * Reloaded when either the tenant or the person changes — not the tenant alone.
 *
 * Seeding goes tenant first, then people, so a list fetched on the tenant change is
 * a list of nobody, and it never refreshed: the sidebar showed names while the chat
 * header showed a fragment of an id, because the sidebar happened to refetch on the
 * token and this did not.
 */
watch(
  () => [session.tenant.value?.id, session.user.value?.id].join(':'),
  () => {
    // A different person sees a different list, so nothing the last one had open
    // may stay open.
    selected.value = undefined;
    if (session.tenant.value?.id) {
      void users.run();
    }
  },
  { immediate: true },
);

/** Ids are what the API speaks; people are what a chat window should show. */
const nameOf = (id: string): string => {
  const user = (users.data.value ?? []).find((candidate: User) => candidate.id === id);
  return user?.displayName ?? id.slice(-6);
};

const ready = computed(() => session.isReady.value && Boolean(session.token.value));
</script>

<template>
  <div v-if="!ready" class="empty-shell">
    <div class="empty-shell__card">
      <h2>Nobody is signed in</h2>
      <p>
        Messaging reads the tenant out of the token on every request, so there is
        nothing to show until there is one. Use the switcher in the top right —
        make a tenant, add two people, and become one of them.
      </p>
    </div>
  </div>

  <div v-else class="messenger">
    <ConversationList
      :token="session.token.value ?? ''"
      :selected-id="selected?.id"
      :people="users.data.value ?? []"
      :name-of="nameOf"
      @select="selected = $event"
    />

    <ChatThread
      v-if="selected"
      :key="selected.id"
      :token="session.token.value ?? ''"
      :conversation="selected"
      :self-id="session.user.value?.id ?? ''"
      :name-of="nameOf"
    />

    <div v-else class="pick">
      <p>Choose a chat, or start one.</p>
    </div>

    <!--
      Folded away by default. It is the part of this demo that exists to prove the
      API refuses things, not part of using the product, and an accordion at the
      bottom of the thread is where a reviewer will look for it without it being in
      everyone else's way.
    -->
    <details v-if="selected" class="probes">
      <!-- No `:open` and no handler: `details` already owns this, and binding a ref
           to it as well means the click toggles the element and the patch toggles it
           back. It looked like a summary that did nothing. -->
      <summary>Prove the isolation rules</summary>
      <IsolationProbes
        :conversation-id="selected.id"
        :tenant-id="session.tenant.value?.id ?? ''"
      />
    </details>
  </div>
</template>

<style scoped>
.messenger {
  display: grid;
  /* Two columns on a desktop; the rail collapses above the thread on a phone. */
  grid-template-columns: minmax(220px, 300px) 1fr;
  grid-template-rows: 1fr auto;
  min-height: 0;
  height: 100%;
}

.messenger > :first-child {
  grid-row: 1 / span 2;
}

.pick {
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 14px;
}

.probes {
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.probes summary {
  padding: var(--space-2) var(--space-4);
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}

.probes summary:hover {
  color: var(--text);
}

.empty-shell {
  display: grid;
  place-items: center;
  padding: var(--space-6) var(--space-4);
}

.empty-shell__card {
  max-width: 46ch;
  padding: var(--space-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.empty-shell__card h2 {
  margin: 0 0 var(--space-2);
  font-size: 16px;
}

.empty-shell__card p {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}

@media (max-width: 720px) {
  .messenger {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }

  .messenger > :first-child {
    grid-row: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
    max-height: 40vh;
  }
}
</style>
