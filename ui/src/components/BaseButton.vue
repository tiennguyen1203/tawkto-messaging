<script setup lang="ts">
import { computed } from 'vue';

import BaseSpinner from './BaseSpinner.vue';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    /** Disables the button, swaps the label for a spinner, and marks it busy. */
    loading?: boolean;
    disabled?: boolean;
    /** Default is `button`: inside a form, the HTML default would submit it. */
    type?: 'button' | 'submit';
  }>(),
  { variant: 'secondary', loading: false, disabled: false, type: 'button' },
);

defineEmits<{ click: [MouseEvent] }>();

/**
 * Loading disables the button as surely as `disabled` does — that is the whole
 * point of the state. Two submissions from one impatient double click is the bug
 * it exists to prevent, and the `disabled` attribute below is what prevents it: the
 * browser never dispatches the second click.
 *
 * There was a guard in the click handler here as well. It was removed after a
 * mutation test: deleting it broke no test, because there is no path where a click
 * reaches the handler while the attribute is set. A second check that cannot fail
 * is not defence in depth, it is a claim nobody can verify.
 */
const inert = computed(() => props.disabled || props.loading);
</script>

<template>
  <button
    :class="['btn', `btn--${variant}`, { 'btn--loading': loading }]"
    :type="type"
    :disabled="inert"
    :aria-busy="loading || undefined"
    @click="$emit('click', $event)"
  >
    <!--
      The label stays in the DOM under the spinner rather than being replaced by it.
      Swapping the text changes the button's width mid-click, which moves whatever
      sits beside it — and the pointer that was aimed at it.
    -->
    <span class="btn__label"><slot /></span>
    <span v-if="loading" class="btn__spinner"><BaseSpinner /></span>
  </button>
</template>

<style scoped>
.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  /* Comfortably past the 24×24 CSS px floor WCAG 2.2 sets for pointer targets. */
  min-height: 34px;
  padding: 0 var(--space-3);
  border-radius: var(--radius);
  border: 1px solid transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease),
    border-color var(--motion-fast) var(--ease),
    opacity var(--motion-fast) var(--ease);
}

.btn:disabled {
  /* Both, not either: opacity alone reads as "low emphasis" to someone who cannot
     see the pointer change, and the cursor alone is invisible until you reach it. */
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--accent);
  color: var(--accent-text);
}

.btn--secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border-strong);
}

.btn--danger {
  background: var(--danger);
  color: var(--danger-text);
}

.btn--ghost {
  background: transparent;
  color: var(--muted);
}

.btn:not(:disabled):hover {
  filter: brightness(1.08);
}

.btn--ghost:not(:disabled):hover {
  background: var(--surface-sunken);
  color: var(--text);
}

/* The label is hidden from sight but keeps its width; the spinner sits over it. */
.btn--loading .btn__label {
  visibility: hidden;
}

.btn__spinner {
  position: absolute;
  display: inline-flex;
}
</style>
