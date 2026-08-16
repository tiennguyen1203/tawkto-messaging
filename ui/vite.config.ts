import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const IDENTITY = process.env.IDENTITY_URL ?? 'http://localhost:3001';
const MESSAGING = process.env.MESSAGING_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same origin in development, so no service needs a CORS policy for it. A
    // proxy is a line of config; CORS is a header policy on a server that then has
    // to be right in production too. See PLAN §10b.
    //
    // Identity gets a prefix of its own rather than being routed by path: both
    // services answer on `/api/health`, so a path alone cannot say which one is
    // meant. The prefix is stripped on the way through.
    proxy: {
      '/identity-api': {
        target: IDENTITY,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/identity-api/, ''),
      },
      '/api': { target: MESSAGING, changeOrigin: true },
    },
  },
});
