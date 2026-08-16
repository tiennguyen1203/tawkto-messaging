<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';

import IdentitySwitcher from './IdentitySwitcher.vue';
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Messaging demo</h1>
      <nav>
        <RouterLink to="/">Chats</RouterLink>
        <RouterLink to="/health">Health</RouterLink>
      </nav>
      <!-- Top right, where an account menu is in every product anyone has used. -->
      <IdentitySwitcher />
    </header>

    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>
