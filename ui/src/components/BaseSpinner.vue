<script setup lang="ts">
/**
 * The only spinner. Used inside BaseButton and AsyncPanel rather than by pages
 * directly, so "busy" looks the same everywhere it appears.
 *
 * Silent to assistive technology on purpose: it is decoration next to text that
 * already says what is happening, and a spinning icon announced as "loading" on top
 * of a label that says "Loading…" is the same news twice. The component that owns
 * the wait sets `aria-busy`.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 14 });
</script>

<template>
  <svg
    class="spinner"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" />
    <path
      d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.spinner {
  animation: spin 700ms linear infinite;
  flex: none;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/*
 * Reduced motion stops the rotation, and stopping it would leave an arc that reads
 * as nothing at all — so it pulses instead. The global rule collapses durations to
 * near zero, which is why the opacity is restated here rather than animated.
 */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
    opacity: 0.7;
  }
}
</style>
