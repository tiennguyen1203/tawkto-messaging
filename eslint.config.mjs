// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        // Both projects, listed explicitly: the app's tsconfig excludes scripts/
        // (they sit outside its rootDir), so projectService alone cannot type
        // them and typed rules silently fail to parse them.
        project: ['./tsconfig.json', './tsconfig.scripts.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'error',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/messaging/common/enums/*', '!@/messaging/common/enums'],
              message:
                'Import from @/messaging/common/enums instead of individual files',
            },
            {
              group: [
                  '@/shared/constants/*',
                  '!@/shared/constants',
                  '@/messaging/common/constants/*',
                  '!@/messaging/common/constants',
                ],
              message:
                'Import the constants barrel, not an individual file inside it',
            },
          ],
        },
      ],
    },
  },
  {
    // ── Bounded context boundaries ────────────────────────────────────────
    //
    // What makes src/messaging a context rather than a folder. Contexts sit on
    // the shared kernel below them — common/, infra/, health-check/ — and never
    // on each other. Composition roots (app.module, consumer.module, main*.ts)
    // sit above every context and may wire them together; that is what a
    // composition root is for.
    //
    // Two contexts in one deployable is a decision about packaging, not about
    // boundaries. This rule is what stops the two quietly becoming one thing.
    // See ADR-007.
    files: ['src/messaging/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/identity', '@/identity/*', '@/identity/**'],
              message:
                'messaging must not import from identity. Contexts share the kernel (common/, infra/), never each other — see ADR-007. What messaging needs to know about a tenant arrives in the verified JWT, or over a topic.',
            },
          ],
        },
      ],
    },
  },
  {
    // The kernel must not know its consumers. A shared module that imports a
    // context is that context's code sitting in the wrong directory — which is
    // exactly what `commonModules` had become before the split.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/messaging', '@/messaging/*', '@/messaging/**',
                '@/identity', '@/identity/*', '@/identity/**',
              ],
              message:
                'shared/ must not import a bounded context — see ADR-007. If shared code needs something a context has, take it as a parameter (see FullAppTestHelper and setupApp).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/identity/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/messaging', '@/messaging/*', '@/messaging/**'],
              message:
                'identity must not import from messaging. Contexts share the kernel (common/, infra/), never each other — see ADR-007.',
            },
          ],
        },
      ],
    },
  },
  {
    // Operational scripts are command-line tools: printing is their output.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
