<script setup lang="ts">
import { onMounted } from 'vue';

import { request } from '@/api/client';
import { identityPath, messagingPath } from '@/api/services';
import { useRequest } from '@/api/use-request';
import AsyncPanel from '@/components/AsyncPanel.vue';
import BaseBadge from '@/components/BaseBadge.vue';
import BaseCard from '@/components/BaseCard.vue';

/**
 * The only page this part ships, and it exists to prove the wiring rather than to
 * be useful: the proxy reaches both services, the envelope is unwrapped, and the
 * shared components carry the loading, error and retry behaviour every later page
 * will use.
 */
type Health = {
  status: string;
  info: Record<string, { status: string }>;
};

const identity = useRequest(() => request<Health>(identityPath('/api/health')));
const messaging = useRequest(() => request<Health>(messagingPath('/api/health')));

onMounted(() => {
  void identity.run();
  void messaging.run();
});

/**
 * Terse's health check answers `ok` for the whole report and `up` for each
 * indicator inside it. Comparing only against `ok` painted every healthy
 * dependency red — which a green test suite was perfectly happy with, because
 * nothing asserted on the colour. A screenshot caught it.
 */
const HEALTHY = new Set(['ok', 'up']);

const toneOf = (status?: string): 'success' | 'danger' =>
  status && HEALTHY.has(status) ? 'success' : 'danger';
</script>

<template>
  <div class="stack">
    <BaseCard title="Identity">
      <AsyncPanel
        :pending="identity.pending.value"
        :error="identity.error.value"
        @retry="identity.run()"
      >
        <div class="stack">
          <!-- The word, not only the colour: green and red look alike to enough
               people that a status told in colour alone is not told at all. -->
          <BaseBadge :tone="toneOf(identity.data.value?.status)">
            {{ identity.data.value?.status }}
          </BaseBadge>
          <div class="row">
            <BaseBadge
              v-for="(value, name) in identity.data.value?.info"
              :key="name"
              :tone="toneOf(value.status)"
            >
              {{ name }}: {{ value.status }}
            </BaseBadge>
          </div>
        </div>
      </AsyncPanel>
    </BaseCard>

    <BaseCard title="Messaging">
      <AsyncPanel
        :pending="messaging.pending.value"
        :error="messaging.error.value"
        @retry="messaging.run()"
      >
        <div class="stack">
          <BaseBadge :tone="toneOf(messaging.data.value?.status)">
            {{ messaging.data.value?.status }}
          </BaseBadge>
          <div class="row">
            <BaseBadge
              v-for="(value, name) in messaging.data.value?.info"
              :key="name"
              :tone="toneOf(value.status)"
            >
              {{ name }}: {{ value.status }}
            </BaseBadge>
          </div>
        </div>
      </AsyncPanel>
    </BaseCard>
  </div>
</template>
