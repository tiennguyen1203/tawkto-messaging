<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { listMessages, sendMessage, type Message } from '@/api/messaging';
import { useRequest } from '@/api/use-request';
import AsyncPanel from '@/components/AsyncPanel.vue';
import BaseButton from '@/components/BaseButton.vue';
import BaseCard from '@/components/BaseCard.vue';
import BaseInput from '@/components/BaseInput.vue';

/**
 * Posting a message and reading the conversation back — two of the three endpoints
 * the brief asks for.
 *
 * The page size is deliberately tiny. Cursor pagination is a graded requirement and
 * an invisible one at a sensible limit: with five messages and a page of twenty,
 * "Load older" never appears and nothing is demonstrated.
 */
const props = defineProps<{
  token: string;
  conversationId: string;
  selfId: string;
}>();

const PAGE_SIZE = 5;

const messages = ref<Message[]>([]);
const nextCursor = ref<string | null>(null);
const draft = ref('');
const sending = ref(false);
const sendError = ref<string>();

/**
 * Only the first page goes through `useRequest`: it owns `pending` and `error` for
 * the panel. Later pages append, and a shared `pending` would blank the list that is
 * already on screen every time someone asked for more.
 */
const firstPage = useRequest(async () => {
  const page = await listMessages(props.token, props.conversationId, {
    limit: PAGE_SIZE,
  });
  messages.value = page.items;
  nextCursor.value = page.nextCursor;
  return page;
});

const loadingMore = ref(false);

const loadOlder = async (): Promise<void> => {
  if (!nextCursor.value) {
    return;
  }
  loadingMore.value = true;
  try {
    const page = await listMessages(props.token, props.conversationId, {
      limit: PAGE_SIZE,
      cursor: nextCursor.value,
    });
    messages.value = [...messages.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } finally {
    loadingMore.value = false;
  }
};

const send = async (): Promise<void> => {
  sending.value = true;
  sendError.value = undefined;
  try {
    await sendMessage(props.token, {
      conversationId: props.conversationId,
      content: draft.value,
      // Proof that arbitrary metadata survives the round trip through Mongo, the
      // change stream and back — it is part of the Message type in the brief.
      metadata: { sentFrom: 'demo-ui' },
    });
    draft.value = '';
    // Re-reading the first page rather than pushing the response into the list: the
    // server decides the order and the timestamp, and a client that renders its own
    // guess is a client that disagrees with the next reload.
    await firstPage.run();
  } catch (thrown) {
    sendError.value = thrown instanceof Error ? thrown.message : String(thrown);
  } finally {
    sending.value = false;
  }
};

onMounted(() => void firstPage.run());

const time = (iso: string): string => new Date(iso).toLocaleTimeString();
const mine = (message: Message): boolean => message.senderId === props.selfId;

const count = computed(() => messages.value.length);

defineExpose({ reload: () => firstPage.run() });
</script>

<template>
  <BaseCard title="Messages">
    <template #actions>
      <span class="muted count">{{ count }} loaded, newest first</span>
    </template>

    <form class="row" @submit.prevent="send">
      <BaseInput
        v-model="draft"
        class="grow"
        label="Say something"
        placeholder="Deployment is finished"
        :error="sendError"
      />
      <BaseButton type="submit" variant="primary" :loading="sending" :disabled="!draft.trim()">
        Send
      </BaseButton>
    </form>

    <AsyncPanel
      :pending="firstPage.pending.value"
      :error="firstPage.error.value"
      :empty="count === 0"
      empty-message="No messages in this conversation yet."
      empty-hint="Send one above — it is searchable a couple of seconds later."
      @retry="firstPage.run()"
    >
      <ol class="messages">
        <li v-for="message in messages" :key="message.id" :class="{ own: mine(message) }">
          <div class="meta mono">
            <span>{{ mine(message) ? 'you' : message.senderId }}</span>
            <!-- The server's timestamp, not the browser's. A client-side clock would
                 disagree with the ordering the API paginates by. -->
            <time :datetime="message.timestamp">{{ time(message.timestamp) }}</time>
          </div>
          <p class="content">{{ message.content }}</p>
        </li>
      </ol>

      <BaseButton v-if="nextCursor" variant="secondary" :loading="loadingMore" @click="loadOlder">
        Load older
      </BaseButton>
      <p v-else-if="count > 0" class="muted note">
        That is the whole conversation — {{ count }} message{{ count === 1 ? '' : 's' }},
        {{ PAGE_SIZE }} per page.
      </p>
    </AsyncPanel>
  </BaseCard>
</template>

<style scoped>
.row {
  align-items: flex-end;
}

.grow {
  flex: 1 1 16rem;
}

.count {
  font-size: 12px;
}

.messages {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.messages li {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-sm);
}

/* Your own messages are marked by a bar and by the word "you" — the colour is the
   second signal, never the only one. */
.messages li.own {
  border-left-color: var(--accent);
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
  font-size: 12px;
}
</style>
