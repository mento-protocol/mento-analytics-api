import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@common': resolve(__dirname, './src/common'),
      '@api': resolve(__dirname, './src/api'),
      '@types': resolve(__dirname, './src/types'),
      '@config': resolve(__dirname, './src/config'),
      // Force CJS build of mento-sdk — its ESM build has extensionless imports
      // that fail Node's ESM resolver
      '@mento-protocol/mento-sdk': resolve(__dirname, './node_modules/@mento-protocol/mento-sdk/dist/index.js'),
    },
  },
});
