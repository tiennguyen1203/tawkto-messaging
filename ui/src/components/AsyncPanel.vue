<script setup lang="ts">
import BaseButton from './BaseButton.vue';
import BaseSpinner from './BaseSpinner.vue';
import EmptyState from './EmptyState.vue';

/**
 * The four states every request has — waiting, failed, empty, ready — in one place,
 * so no page invents its own and, more to the point, so none of them forgets one.
 * "Failed" and "empty" are the two that get left out, and they are the two a
 * reviewer is most likely to hit.
 *
 * It pairs with `useRequest`, whose `pending`/`error` map straight onto the props.
 *
 * `aria-busy` goes on the region rather than on the spinner: it is the content that
 * is unavailable, and the spinner is decoration inside it. The min-height reserves
 * the space a one-line state takes, so swapping between states does not jump the
 * page around whatever sits below.
 *
 * The template has exactly one root element, and the prose above is here rather
 * than above that element for a reason: a comment before the root makes the
 * component a fragment, and a fragment has no root to put `aria-busy` on or to
 * receive any attribute a caller passes down.
 */
withDefaults(
  defineProps<{
    pending: boolean;
    error?: string;
    empty?: boolean;
    emptyMessage?: string;
    emptyHint?: string;
    /**
     * Declared as a prop rather than an emit, and `@retry="..."` still binds to it.
     * A declared emit is stripped out of `$attrs`, so there is no way to ask whether
     * anyone is listening — and a "Try again" button that emits into nothing is
     * worse than no button. As a prop, its presence is the question and the answer.
     */
    onRetry?: () => void;
  }>(),
  { empty: false, emptyMessage: 'Nothing here yet.' },
);

</script>

<template>
  <div class="async" :aria-busy="pending || undefined">
    <p v-if="pending" class="async__state muted">
      <BaseSpinner />
      <span>Loading…</span>
    </p>

    <!--
      role="alert" because a failure that arrives after the page settled is news:
      without it the screen reader has already finished reading and moves on.
    -->
    <div v-else-if="error" class="async__state async__error" role="alert">
      <p class="async__message">{{ error }}</p>
      <BaseButton v-if="onRetry" variant="secondary" @click="onRetry()">
        Try again
      </BaseButton>
    </div>

    <EmptyState v-else-if="empty" :message="emptyMessage" :hint="emptyHint">
      <template v-if="$slots.emptyAction" #action><slot name="emptyAction" /></template>
    </EmptyState>

    <slot v-else />
  </div>
</template>

<style scoped>
.async {
  min-height: 44px;
}

.async__state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: 14px;
}

.async__error {
  flex-wrap: wrap;
  color: var(--danger);
}

.async__message {
  margin: 0;
  /* Server messages carry ids and quoted values that have no spaces in them. */
  overflow-wrap: anywhere;
}
</style>
