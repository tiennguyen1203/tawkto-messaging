import { defineConfig } from '@playwright/test';

/**
 * Drives the real container, not the dev server: what a reviewer opens is the nginx
 * image, and the two differ in exactly the way that has already caught this project
 * out once — the proxy prefixes. Point BASE_URL at :5173 to shoot the dev server
 * instead.
 *
 * These are screenshots first and assertions second. They exist so a change to the
 * interface can be looked at, and so the states nobody clicks through by hand —
 * empty, failed — are seen at all.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  // One worker: every test drives the same stack and creates tenants in it.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8088',
    viewport: { width: 1180, height: 860 },
  },
});
