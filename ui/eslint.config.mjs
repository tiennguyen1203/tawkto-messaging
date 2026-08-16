import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';

// This package needs its own config for the same reason it needs its own
// lockfile and its own @types/node: ESLint searches upwards from the working
// directory, so without a config here it finds the server's, which types every
// file against the server's tsconfigs — and none of them include ui/. Every file
// then fails to parse rather than failing to lint, which reads like a broken
// project instead of a missing config.
export default defineConfigWithVueTs(
  { files: ['**/*.ts', '**/*.vue'] },
  { ignores: ['dist/**', 'node_modules/**'] },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
);
