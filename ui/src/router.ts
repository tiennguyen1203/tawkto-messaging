import { createRouter, createWebHistory } from 'vue-router';

import HealthPage from '@/pages/HealthPage.vue';
import PickerPage from '@/pages/PickerPage.vue';

/**
 * The picker is the landing page because it is the point of the tool: nothing else
 * here works until you are somebody. Health moved to its own route rather than
 * being deleted — it is what to open first when the picker fails and the question
 * is whether the services are up.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'picker', component: PickerPage },
    { path: '/health', name: 'health', component: HealthPage },
  ],
});
