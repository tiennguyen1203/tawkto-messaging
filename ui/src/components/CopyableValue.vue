<script setup lang="ts">
import { ref } from 'vue';

import BaseButton from './BaseButton.vue';

/**
 * A long opaque string — a token, a tenant id, a conversation id — shown so it can
 * be read and taken.
 *
 * The whole demo runs on values like these being moved from one place to another,
 * and selecting 24 characters of monospace by hand is where a reviewer's patience
 * goes. Truncation is visual only: the full value stays in the DOM and in the
 * clipboard, so nothing on screen is a lie about what you copied.
 */
const props = withDefaults(
  defineProps<{
    value: string;
    label?: string;
    /** For a token: shows a masked value until the reader asks for it. */
    secret?: boolean;
  }>(),
  { secret: false },
);

const revealed = ref(false);
const copied = ref(false);
const failed = ref(false);

let resetTimer: ReturnType<typeof setTimeout> | undefined;

const copy = async (): Promise<void> => {
  clearTimeout(resetTimer);
  copied.value = false;
  failed.value = false;

  try {
    // Absent over plain http on anything but localhost, and absent in jsdom. A
    // demo tool that throws an unhandled rejection because the page is not secure
    // is a worse outcome than a button that says it could not.
    if (!navigator.clipboard) {
      throw new Error('Clipboard unavailable');
    }
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
  } catch {
    failed.value = true;
  }

  resetTimer = setTimeout(() => {
    copied.value = false;
    failed.value = false;
  }, 2000);
};
</script>

<template>
  <div class="copyable">
    <span v-if="label" class="copyable__label">{{ label }}</span>

    <code class="copyable__value mono">{{ secret && !revealed ? '•'.repeat(24) : value }}</code>

    <BaseButton v-if="secret" variant="ghost" @click="revealed = !revealed">
      {{ revealed ? 'Hide' : 'Show' }}
    </BaseButton>

    <BaseButton variant="ghost" @click="copy">Copy</BaseButton>

    <!--
      polite, not assertive: confirming a copy is not worth interrupting whatever
      the reader is in the middle of. It is a live region so the confirmation is
      heard at all — a checkmark that only appears visually tells a screen-reader
      user nothing about whether the click worked.
    -->
    <span class="copyable__status" role="status" aria-live="polite">
      <template v-if="copied">Copied</template>
      <template v-else-if="failed">Copy failed — select the text instead</template>
    </span>
  </div>
</template>

<style scoped>
.copyable {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.copyable__label {
  font-size: 13px;
  color: var(--muted);
}

.copyable__value {
  flex: 1 1 12ch;
  /* min-width lets the flex child actually shrink; without it the ellipsis never
     appears and the row overflows its container instead. */
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.copyable__status {
  font-size: 12px;
  color: var(--muted);
  /* Reserved, so the row does not change width when the word appears. */
  min-width: 6ch;
}
</style>
