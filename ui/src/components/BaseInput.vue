<script setup lang="ts">
import BaseField from './BaseField.vue';

withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    hint?: string;
    error?: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    /** Drives the mobile keyboard and the browser's own validation hints. */
    type?: 'text' | 'email' | 'search';
    /** Ids and tokens are read character by character; proportional text fights that. */
    mono?: boolean;
  }>(),
  { required: false, disabled: false, type: 'text', mono: false },
);

/**
 * `update:modelValue` rather than writing to the prop — the parent owns the value,
 * and a component that mutates what it was handed is a component whose state you
 * cannot find from the outside.
 */
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const onInput = (event: Event): void => {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
};
</script>

<template>
  <BaseField
    v-slot="{ controlId, describedBy, invalid }"
    :label="label"
    :hint="hint"
    :error="error"
    :required="required"
  >
    <input
      :id="controlId"
      :class="['input', { 'input--invalid': invalid, mono }]"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :aria-invalid="invalid || undefined"
      @input="onInput"
    />
  </BaseField>
</template>

<style scoped>
.input {
  width: 100%;
  min-height: 34px;
  padding: 0 var(--space-3);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  font: inherit;
  /* 16px on the control itself: anything smaller makes iOS Safari zoom the page on
     focus, and it does not zoom back out. */
  font-size: 16px;
  transition: border-color var(--motion-fast) var(--ease);
}

.input.mono {
  font-family: var(--font-mono);
  font-size: 13px;
}

/* Paired with the message BaseField renders and with aria-invalid — the red edge
   is the third signal, not the only one. */
.input--invalid {
  border-color: var(--danger);
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input::placeholder {
  color: var(--muted);
}
</style>
