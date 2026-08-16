<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <header class="app-header">
    <h1>Messaging demo</h1>
    <nav>
      <RouterLink to="/">Picker</RouterLink>
      <RouterLink to="/health">Health</RouterLink>
    </nav>
  </header>

  <main class="app-main">
    <RouterView />
  </main>
</template>
