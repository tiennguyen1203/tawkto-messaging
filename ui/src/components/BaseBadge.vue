<script setup lang="ts">
/**
 * A small status label.
 *
 * The tone is decoration: the text inside carries the meaning, so a reader who
 * cannot tell the green from the red still learns the state. A badge whose only
 * content is a colour is a badge that says nothing to a colourblind reviewer, and
 * nothing at all to a screen reader.
 */
withDefaults(
  defineProps<{ tone?: 'neutral' | 'accent' | 'success' | 'danger' }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <span :class="['badge', `badge--${tone}`]"><slot /></span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  /* Wraps rather than truncating: a status nobody can finish reading is worse than
     one that takes two lines. */
  overflow-wrap: anywhere;
}

.badge--neutral {
  background: var(--surface-sunken);
  color: var(--muted);
  border: 1px solid var(--border);
}

.badge--accent {
  background: var(--accent-weak);
  color: var(--accent);
}

.badge--success {
  background: var(--success-weak);
  color: var(--success);
}

.badge--danger {
  background: var(--danger-weak);
  color: var(--danger);
}
</style>
