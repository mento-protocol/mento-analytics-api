const { defineConfig, globalIgnores } = require('eslint/config');

const tsParser = require('@typescript-eslint/parser');
const typescriptEslintEslintPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');
const js = require('@eslint/js');

const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  // Config for test files - no type-aware linting
  {
    files: ['**/*.spec.ts', 'vitest.config.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslintEslintPlugin,
    },
    extends: compat.extends('plugin:prettier/recommended'),
    rules: {
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
          printWidth: 120,
        },
      ],
    },
  },
  // Config for source files
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslintEslintPlugin,
    },
    extends: compat.extends('plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'),
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
          printWidth: 120,
        },
      ],
    },
  },
  globalIgnores(['dist/**']),
]);
