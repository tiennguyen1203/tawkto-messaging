<script setup lang="ts">
/**
 * The three states every page has, in one place: waiting, failed, or ready.
 *
 * Here so that no page invents its own way of saying "loading" and, more to the
 * point, so none of them forgets to say "failed" at all.
 */
defineProps<{
  pending: boolean;
  error?: string;
  empty?: boolean;
}>();
</script>

<template>
  <div class="panel">
    <p v-if="pending" class="muted">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="empty" class="muted">Nothing here yet.</p>
    <slot v-else />
  </div>
</template>
