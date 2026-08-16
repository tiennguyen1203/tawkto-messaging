import { createApp } from 'vue';

import AppShell from '@/shell/AppShell.vue';
import { router } from '@/router';
import './styles.css';

createApp(AppShell).use(router).mount('#app');
