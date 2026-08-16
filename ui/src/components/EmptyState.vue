<script setup lang="ts">
/**
 * What a list says when it has nothing in it.
 *
 * Separate from AsyncPanel because "empty" is also a state a page reaches without
 * a request behind it, and because the interesting part is the action: an empty
 * demo is almost always one seeding call away from being useful, and the message
 * should say which one. A blank area says only that something might be broken.
 */
defineProps<{ message: string; hint?: string }>();
</script>

<template>
  <div class="empty">
    <p class="empty__message">{{ message }}</p>
    <p v-if="hint" class="empty__hint">{{ hint }}</p>
    <div v-if="$slots.action" class="empty__action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  justify-items: start;
  gap: var(--space-2);
  padding: var(--space-4) 0;
}

.empty__message {
  margin: 0;
  font-size: 14px;
  color: var(--text);
}

.empty__hint {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.empty__action {
  margin-top: var(--space-1);
}
</style>
