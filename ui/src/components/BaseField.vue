<script setup lang="ts">
import { computed, useId } from 'vue';

/**
 * The label, hint and error around a control — and the wiring between them.
 *
 * It exists because that wiring is what gets forgotten. A visible label is easy to
 * remember; `for`/`id`, and an error that a screen reader reaches only if
 * `aria-describedby` points at it, are not. Putting it in one component means
 * BaseInput and BaseSelect cannot each get it subtly wrong, and the next control
 * inherits it for free.
 *
 * The control is a slot rather than a prop so this stays agnostic about what it
 * wraps; it hands down the ids through the slot scope.
 */
const props = defineProps<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}>();

const uid = useId();
const controlId = `field-${uid}`;
const hintId = `${controlId}-hint`;
const errorId = `${controlId}-error`;

/**
 * Both, when both are present: the hint explains the field and the error explains
 * the rejection, and a reader who hears only one of them is missing half of it.
 * Undefined rather than an empty string, so the attribute is absent when there is
 * nothing to point at.
 */
const describedBy = computed(() => {
  const ids = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
});
</script>

<template>
  <div class="field">
    <label :for="controlId">
      {{ label }}
      <span v-if="required" class="required" aria-hidden="true">*</span>
      <span v-if="required" class="sr-only">(required)</span>
    </label>

    <slot
      :control-id="controlId"
      :described-by="describedBy"
      :invalid="Boolean(error)"
    />

    <p v-if="hint" :id="hintId" class="hint">{{ hint }}</p>

    <!--
      role="alert" so a failure that appears after submission is announced rather
      than sitting there silently, and below the control rather than in a summary
      at the top, so the field it belongs to is not a guess.
    -->
    <p v-if="error" :id="errorId" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.field {
  display: grid;
  gap: var(--space-1);
}

label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.required {
  color: var(--danger);
  margin-left: 2px;
}

.hint,
.error {
  margin: 0;
  font-size: 12px;
}

.hint {
  color: var(--muted);
}

.error {
  color: var(--danger);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
