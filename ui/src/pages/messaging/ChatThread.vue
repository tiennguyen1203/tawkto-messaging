<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';

import {
  listMessages,
  searchMessages,
  sendMessage,
  type Conversation,
  type Message,
} from '@/api/messaging';
import { useRequest } from '@/api/use-request';
import AsyncPanel from '@/components/AsyncPanel.vue';
import BaseButton from '@/components/BaseButton.vue';
import BaseInput from '@/components/BaseInput.vue';

/**
 * The conversation itself: bubbles, a composer at the bottom, and a search that
 * takes over the thread while it has a query in it.
 *
 * Search lives here rather than in a panel of its own because it is a way of
 * looking at this conversation, not a separate feature — and because a second list
 * of the same messages elsewhere on screen was genuinely confusing to read.
 */
const props = defineProps<{
  token: string;
  conversation: Conversation;
  selfId: string;
  nameOf: (id: string) => string;
}>();

/** Small on purpose: cursor pagination is invisible at a sensible page size. */
const PAGE_SIZE = 5;

const messages = ref<Message[]>([]);
const nextCursor = ref<string | null>(null);
const draft = ref('');
const sending = ref(false);
const sendError = ref<string>();
const loadingOlder = ref(false);

const query = ref('');
const hits = ref<Message[]>([]);
const total = ref(0);
const searching = ref(false);
const searched = ref(false);
const searchError = ref<string>();

const thread = useTemplateRef<HTMLElement>('thread');

const firstPage = useRequest(async () => {
  const page = await listMessages(props.token, props.conversation.id, {
    limit: PAGE_SIZE,
  });
  messages.value = page.items;
  nextCursor.value = page.nextCursor;
  return page;
});

/** Oldest at the top, like every chat client — the API answers newest first. */
const ordered = computed(() => [...messages.value].reverse());

const toBottom = async (): Promise<void> => {
  await nextTick();
  const element = thread.value;
  if (element) {
    element.scrollTop = element.scrollHeight;
  }
};

const reload = async (): Promise<void> => {
  await firstPage.run();
  await toBottom();
};

watch(() => props.conversation.id, () => {
  query.value = '';
  searched.value = false;
  hits.value = [];
  void reload();
}, { immediate: true });

const loadOlder = async (): Promise<void> => {
  if (!nextCursor.value) {
    return;
  }
  loadingOlder.value = true;
  try {
    const page = await listMessages(props.token, props.conversation.id, {
      limit: PAGE_SIZE,
      cursor: nextCursor.value,
    });
    // Appended, then reversed for display: the API pages backwards through time.
    messages.value = [...messages.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } finally {
    loadingOlder.value = false;
  }
};

const send = async (): Promise<void> => {
  sending.value = true;
  sendError.value = undefined;
  try {
    await sendMessage(props.token, {
      conversationId: props.conversation.id,
      content: draft.value,
      metadata: { sentFrom: 'demo-ui' },
    });
    draft.value = '';
    // Re-read rather than push the response in: the server owns the order and the
    // timestamp, and a client that renders its own guess disagrees with the reload.
    await reload();
  } catch (thrown) {
    sendError.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    sending.value = false;
  }
};

const runSearch = async (): Promise<void> => {
  if (!query.value.trim()) {
    searched.value = false;
    hits.value = [];
    return;
  }

  searching.value = true;
  searchError.value = undefined;
  try {
    const page = await searchMessages(props.token, props.conversation.id, query.value, {
      limit: 20,
    });
    hits.value = page.items;
    total.value = page.total;
    searched.value = true;
  } catch (thrown) {
    searchError.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    searching.value = false;
  }
};

const clearSearch = (): void => {
  query.value = '';
  searched.value = false;
  hits.value = [];
  searchError.value = undefined;
};

const title = computed(() => {
  const others = props.conversation.participantIds.filter((id) => id !== props.selfId);
  return others.length ? others.map(props.nameOf).join(', ') : 'Just you';
});

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <section class="chat" aria-label="Conversation">
    <header class="chat__head">
      <div class="chat__who">
        <span class="chat__avatar" aria-hidden="true">{{ title.slice(0, 1).toUpperCase() }}</span>
        <div>
          <h2>{{ title }}</h2>
          <p class="mono id">{{ conversation.id }}</p>
        </div>
      </div>

      <form class="chat__search" role="search" @submit.prevent="runSearch">
        <BaseInput
          v-model="query"
          label="Search this chat"
          type="search"
          placeholder="deployment"
          :error="searchError"
        />
        <BaseButton type="submit" :loading="searching" :disabled="!query.trim()">
          Search
        </BaseButton>
        <BaseButton v-if="searched" variant="ghost" @click="clearSearch">Clear</BaseButton>
      </form>
    </header>

    <!-- Search replaces the thread while it is active: two lists of the same
         messages side by side was the confusing part of the first attempt. -->
    <div v-if="searched" class="chat__results">
      <p class="results__count">
        {{ total }} match{{ total === 1 ? '' : 'es' }} for “{{ query }}”
      </p>
      <p v-if="hits.length === 0" class="muted note">
        Nothing yet. Search reads Elasticsearch, which is fed by change data capture —
        a message sent seconds ago takes a moment to arrive. Try again.
      </p>
      <ul v-else class="bubbles">
        <li v-for="hit in hits" :key="hit.id" :class="{ own: hit.senderId === selfId }">
          <div class="bubble">
            <span class="bubble__from">{{ hit.senderId === selfId ? 'You' : nameOf(hit.senderId) }}</span>
            <p>{{ hit.content }}</p>
            <time :datetime="hit.timestamp">{{ time(hit.timestamp) }}</time>
          </div>
        </li>
      </ul>
    </div>

    <div v-else ref="thread" class="chat__thread">
      <AsyncPanel
        :pending="firstPage.pending.value"
        :error="firstPage.error.value"
        :empty="messages.length === 0"
        empty-message="No messages yet."
        empty-hint="Say something below — it is searchable a couple of seconds later."
        @retry="reload()"
      >
        <div class="older">
          <BaseButton
            v-if="nextCursor"
            variant="secondary"
            :loading="loadingOlder"
            @click="loadOlder"
          >
            Load older
          </BaseButton>
          <span v-else class="muted note">Beginning of the conversation</span>
        </div>

        <ul class="bubbles">
          <li v-for="message in ordered" :key="message.id" :class="{ own: message.senderId === selfId }">
            <div class="bubble">
              <span class="bubble__from">
                {{ message.senderId === selfId ? 'You' : nameOf(message.senderId) }}
              </span>
              <p>{{ message.content }}</p>
              <time :datetime="message.timestamp">{{ time(message.timestamp) }}</time>
            </div>
          </li>
        </ul>
      </AsyncPanel>
    </div>

    <form class="composer" @submit.prevent="send">
      <BaseInput
        v-model="draft"
        class="grow"
        label="Message"
        placeholder="Write a message…"
        :error="sendError"
      />
      <BaseButton type="submit" variant="primary" :loading="sending" :disabled="!draft.trim()">
        Send
      </BaseButton>
    </form>
  </section>
</template>

<style scoped>
.chat {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 0;
}

.chat__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.chat__who {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.chat__avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  font-weight: 600;
}

.chat__head h2 {
  margin: 0;
  font-size: 15px;
}

.id {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

.chat__search {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
}

.chat__thread,
.chat__results {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4);
}

.older {
  display: flex;
  justify-content: center;
  padding-bottom: var(--space-3);
}

.bubbles {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.bubbles li {
  display: flex;
}

.bubbles li.own {
  justify-content: flex-end;
}

.bubble {
  max-width: min(78%, 46rem);
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px 14px 14px 4px;
}

/* Your own messages sit right and are tinted — and still say "You", because side
   and colour are both invisible to a screen reader. */
.own .bubble {
  background: var(--accent-weak);
  border-color: transparent;
  border-radius: 14px 14px 4px 14px;
}

.bubble__from {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}

.bubble p {
  margin: 2px 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.bubble time {
  font-size: 11px;
  color: var(--muted);
}

.results__count {
  margin: 0 0 var(--space-3);
  font-size: 13px;
  color: var(--muted);
}

.note {
  margin: 0;
  font-size: 13px;
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.grow {
  flex: 1;
}
</style>
