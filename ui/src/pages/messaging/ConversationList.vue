<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import type { User } from '@/api/identity';
import { createConversation, listConversations, type Conversation } from '@/api/messaging';
import { useRequest } from '@/api/use-request';
import AsyncPanel from '@/components/AsyncPanel.vue';
import BaseButton from '@/components/BaseButton.vue';
import BaseSelect from '@/components/BaseSelect.vue';
import { useSession } from '@/session/use-session';

/**
 * The left rail: every conversation this user is in, and the way to start another.
 *
 * `GET /conversations` returns only the caller's own, so this list is already the
 * answer to "what may I see" — there is nothing to filter here, and filtering here
 * would be the wrong place to do it anyway.
 */
const props = defineProps<{
  token: string;
  selectedId?: string;
  /** Handed down rather than fetched again: two copies of one list drifted apart. */
  people: User[];
  nameOf: (id: string) => string;
}>();
const emit = defineEmits<{ select: [Conversation] }>();

const session = useSession();

const conversations = useRequest(() => listConversations(props.token, { limit: 50 }));

const starting = ref(false);
const withUserId = ref('');
const failure = ref<string>();

/** Everyone else in the tenant: a conversation needs a second person. */
const others = computed(() =>
  props.people
    .filter((user) => user.id !== session.user.value?.id)
    .map((user) => ({ value: user.id, label: user.displayName, detail: user.email })),
);

/** A conversation is named after whoever is in it besides you, like any chat app. */
const titleOf = (conversation: Conversation): string => {
  const rest = conversation.participantIds.filter((id) => id !== session.user.value?.id);
  return rest.length ? rest.map(props.nameOf).join(', ') : 'Just you';
};

onMounted(() => void conversations.run());
// The token is the identity: a new one means somebody else's chats.
watch(() => props.token, () => void conversations.run());

const start = async (): Promise<void> => {
  starting.value = true;
  failure.value = undefined;
  try {
    const created = await createConversation(props.token, [withUserId.value]);
    withUserId.value = '';
    await conversations.run();
    emit('select', created);
  } catch (thrown) {
    failure.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    starting.value = false;
  }
};

defineExpose({ reload: () => conversations.run() });
</script>

<template>
  <aside class="rail" aria-label="Conversations">
    <header class="rail__head">
      <h2>Chats</h2>
      <BaseButton variant="ghost" @click="conversations.run()">Refresh</BaseButton>
    </header>

    <div class="rail__new">
      <BaseSelect
        v-model="withUserId"
        label="New chat with"
        placeholder="Choose someone…"
        :options="others"
        :error="failure"
      />
      <BaseButton
        variant="primary"
        :loading="starting"
        :disabled="!withUserId"
        @click="start"
      >
        Start
      </BaseButton>
    </div>

    <AsyncPanel
      :pending="conversations.pending.value"
      :error="conversations.error.value"
      :empty="conversations.data.value?.items.length === 0"
      empty-message="No chats yet."
      empty-hint="Pick somebody above to start one."
      @retry="conversations.run()"
    >
      <ul class="list">
        <li v-for="conversation in conversations.data.value?.items" :key="conversation.id">
          <button
            type="button"
            :class="['entry', { 'entry--on': conversation.id === selectedId }]"
            :aria-current="conversation.id === selectedId ? 'true' : undefined"
            @click="emit('select', conversation)"
          >
            <span class="entry__avatar" aria-hidden="true">
              {{ titleOf(conversation).slice(0, 1).toUpperCase() }}
            </span>
            <span class="entry__text">
              <span class="entry__title">{{ titleOf(conversation) }}</span>
              <span class="entry__sub mono">{{ conversation.id.slice(-8) }}</span>
            </span>
          </button>
        </li>
      </ul>
    </AsyncPanel>
  </aside>
</template>

<style scoped>
.rail {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: var(--space-3);
  padding: var(--space-3);
  border-right: 1px solid var(--border);
  background: var(--surface);
  min-height: 0;
  overflow-y: auto;
}

.rail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rail__head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted);
}

.rail__new {
  display: grid;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.entry {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  background: transparent;
  border: 0;
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.entry:hover {
  background: var(--surface-sunken);
}

/* Selected reads three ways — background, weight, and aria-current — because the
   background alone is a low-contrast difference on both themes. */
.entry--on {
  background: var(--accent-weak);
}

.entry--on .entry__title {
  font-weight: 600;
  color: var(--accent);
}

.entry__avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
}

.entry__text {
  display: grid;
  min-width: 0;
}

.entry__title {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry__sub {
  font-size: 11px;
  color: var(--muted);
}
</style>
