import { createRouter, createWebHistory } from 'vue-router';

import HealthPage from '@/pages/HealthPage.vue';
import MessagingPage from '@/pages/messaging/MessagingPage.vue';

/**
 * Chats are the landing page: this is a messenger, and the identity switcher in the
 * header is how you become somebody, so there is no separate picker page to send
 * anyone to. Health stays on its own route — it is what to open first when the
 * chats fail and the question is whether the services are even up.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chats', component: MessagingPage },
    { path: '/health', name: 'health', component: HealthPage },
  ],
});
