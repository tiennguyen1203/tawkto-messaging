<script setup lang="ts">
import BaseField from './BaseField.vue';

/**
 * A native `<select>`, not a custom listbox. A rebuilt one owes you keyboard
 * navigation, type-ahead, screen-reader semantics and mobile behaviour that the
 * platform gives away — and every hand-rolled version I have seen is missing at
 * least one. The cost is that options cannot be styled much, which is why `detail`
 * is text inside the option rather than a second column.
 *
 * Single root element, no comment above it: a leading comment makes the component a
 * fragment, and attributes a caller passes then land nowhere.
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Shown after the label in muted text — an email, a tenant id, a count. */
  detail?: string;
};

withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    options: SelectOption[];
    hint?: string;
    error?: string;
    /** Shown as a disabled first entry while nothing is chosen. */
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
  }>(),
  { required: false, disabled: false },
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const onChange = (event: Event): void => {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
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
    <select
      :id="controlId"
      :class="['select', { 'select--invalid': invalid }]"
      :value="modelValue"
      :required="required"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :aria-invalid="invalid || undefined"
      @change="onChange"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}{{ option.detail ? ` — ${option.detail}` : '' }}
      </option>
    </select>
  </BaseField>
</template>

<style scoped>
.select {
  width: 100%;
  min-height: 34px;
  padding: 0 var(--space-2);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}

.select--invalid {
  border-color: var(--danger);
}

.select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
