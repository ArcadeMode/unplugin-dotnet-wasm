// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/bin',
      '**/obj',
      '**/.tmp-test',
      '**/wwwroot/_framework',
      '**/test-results',
      '**/coverage',
    ],
  },

  // Loose JS/MJS/CJS: build scripts, fixture bundler configs, integration runner
  {
    files: [
      'scripts/**/*.{js,mjs,cjs}',
      'test/integration/**/*.{js,mjs,cjs}',
      'test/fixtures/**/*.{js,mjs,cjs}',
    ],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },

  // TypeScript: plugin sources + integration tests
  {
    files: ['unplugin-dotnet-wasm/src/**/*.ts', 'test/integration/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Prettier last so its rule wins on all matched files
  prettier,
);
