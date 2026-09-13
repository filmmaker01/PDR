import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/prisma/migrations/**',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipRegExps: true, skipTemplates: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // NestJS резолвит зависимости по метаданным конструктора: `import type`
    // стирает их и ломает DI, поэтому правило здесь выключено.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    // Скрипты и конфиги могут писать в консоль.
    files: ['**/*.config.{ts,mts,js,mjs,cjs}', 'apps/api/prisma/seed.ts', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'apps/api/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
);
