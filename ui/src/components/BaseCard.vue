<script setup lang="ts">
import { useId } from 'vue';

/**
 * A titled surface. The one place a border, a radius and a padding are decided, so
 * two panels side by side cannot disagree about them.
 *
 * The heading level is a prop because a card does not know how deep it sits, and
 * an h2 nested under nothing — or an h4 under an h1 — is a broken outline for
 * anyone navigating by headings.
 *
 * A titled card names its own section, which makes it a landmark: someone using a
 * screen reader can jump between "Tenant", "Messages" and "Search" instead of
 * walking the whole page, and a test can ask for one card's content without
 * matching the same words in another.
 */
withDefaults(defineProps<{ title?: string; as?: 'h2' | 'h3' }>(), { as: 'h2' });

const titleId = `card-title-${useId()}`;
</script>

<template>
  <section class="card" :aria-labelledby="title ? titleId : undefined">
    <header v-if="title || $slots.actions" class="card__head">
      <component :is="as" v-if="title" :id="titleId" class="card__title">{{ title }}</component>
      <div v-if="$slots.actions" class="card__actions"><slot name="actions" /></div>
    </header>

    <slot />
  </section>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
  display: grid;
  gap: var(--space-3);
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.card__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted);
}

.card__actions {
  display: flex;
  gap: var(--space-2);
}
</style>
