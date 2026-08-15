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
              group: ['@/common/enums/*', '!@/common/enums'],
              message:
                'Import from @/common/enums instead of individual files',
            },
            {
              group: ['@/common/constants/*', '!@/common/constants'],
              message:
                'Import from @/common/constants instead of individual files',
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
