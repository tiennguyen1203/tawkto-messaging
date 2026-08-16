<script setup lang="ts">
import { ref } from 'vue';

import { searchMessages, type Message } from '@/api/messaging';
import AsyncPanel from '@/components/AsyncPanel.vue';
import BaseBadge from '@/components/BaseBadge.vue';
import BaseButton from '@/components/BaseButton.vue';
import BaseCard from '@/components/BaseCard.vue';
import BaseInput from '@/components/BaseInput.vue';

/**
 * The third endpoint: full-text search within one conversation.
 *
 * It reads Elasticsearch, which is fed by change data capture — so a message posted
 * a moment ago is not findable for a second or two. That lag is a property of the
 * design (ADR-002), not a bug, and the panel says so rather than letting a reviewer
 * conclude that search is broken.
 */
const props = defineProps<{ token: string; conversationId: string }>();

const PAGE_SIZE = 5;

const q = ref('');
const results = ref<Message[]>([]);
const nextCursor = ref<string | null>(null);
const total = ref(0);
const searched = ref(false);
const pending = ref(false);
const loadingMore = ref(false);
const error = ref<string>();

const run = async (): Promise<void> => {
  pending.value = true;
  error.value = undefined;
  try {
    const page = await searchMessages(props.token, props.conversationId, q.value, {
      limit: PAGE_SIZE,
    });
    results.value = page.items;
    nextCursor.value = page.nextCursor;
    total.value = page.total;
    searched.value = true;
  } catch (thrown) {
    error.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    pending.value = false;
  }
};

const loadMore = async (): Promise<void> => {
  if (!nextCursor.value) {
    return;
  }
  loadingMore.value = true;
  try {
    const page = await searchMessages(props.token, props.conversationId, q.value, {
      limit: PAGE_SIZE,
      cursor: nextCursor.value,
    });
    results.value = [...results.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } finally {
    loadingMore.value = false;
  }
};

const time = (iso: string): string => new Date(iso).toLocaleTimeString();
</script>

<template>
  <BaseCard title="Search">
    <template #actions>
      <BaseBadge v-if="searched" tone="neutral">{{ total }} matching</BaseBadge>
    </template>

    <form class="row" @submit.prevent="run">
      <BaseInput
        v-model="q"
        class="grow"
        label="Find in this conversation"
        type="search"
        placeholder="deployment"
        hint="Scored full-text, scoped to this conversation and this tenant."
      />
      <BaseButton type="submit" variant="primary" :loading="pending" :disabled="!q.trim()">
        Search
      </BaseButton>
    </form>

    <AsyncPanel
      :pending="pending"
      :error="error"
      :empty="searched && results.length === 0"
      empty-message="Nothing matched."
      empty-hint="A message posted seconds ago may not be indexed yet — the event has to travel Mongo → Debezium → Kafka → Elasticsearch. Try again in a moment."
    >
      <p v-if="!searched" class="muted note">
        Post a message in the panel above, then look for one of its words. Expect a
        second or two of lag: search is a projection, not the source of truth.
      </p>

      <template v-else>
        <ol class="hits">
          <li v-for="hit in results" :key="hit.id">
            <div class="meta mono">
              <span>{{ hit.senderId }}</span>
              <time :datetime="hit.timestamp">{{ time(hit.timestamp) }}</time>
            </div>
            <p class="content">{{ hit.content }}</p>
          </li>
        </ol>

        <BaseButton
          v-if="nextCursor"
          variant="secondary"
          :loading="loadingMore"
          @click="loadMore"
        >
          Load more hits
        </BaseButton>
      </template>
    </AsyncPanel>
  </BaseCard>
</template>

<style scoped>
.row {
  align-items: flex-start;
}

.grow {
  flex: 1 1 16rem;
}

.hits {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.hits li {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--muted);
  font-size: 12px;
}

.content {
  margin: 2px 0 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.note {
  margin: 0;
  font-size: 13px;
}
</style>
