<script setup lang="ts">
import { onMounted } from 'vue';

import { request } from '@/api/client';
import { identityPath, messagingPath } from '@/api/services';
import { useRequest } from '@/api/use-request';
import AsyncPanel from '@/shell/AsyncPanel.vue';

/**
 * The only page this part ships, and it exists to prove the wiring rather than to
 * be useful: the proxy reaches both services, the envelope is unwrapped, and the
 * loading and error states are the ones every later page will use.
 */
type Health = {
  status: string;
  info: Record<string, { status: string }>;
};

const identity = useRequest(() =>
  request<Health>(identityPath('/api/health')),
);
const messaging = useRequest(() =>
  request<Health>(messagingPath('/api/health')),
);

onMounted(() => {
  void identity.run();
  void messaging.run();
});
</script>

<template>
  <section class="stack">
    <div>
      <h2>Identity</h2>
      <AsyncPanel :pending="identity.pending.value" :error="identity.error.value">
        <pre>{{ JSON.stringify(identity.data.value, null, 2) }}</pre>
      </AsyncPanel>
    </div>

    <div>
      <h2>Messaging</h2>
      <AsyncPanel
        :pending="messaging.pending.value"
        :error="messaging.error.value"
      >
        <pre>{{ JSON.stringify(messaging.data.value, null, 2) }}</pre>
      </AsyncPanel>
    </div>
  </section>
</template>
