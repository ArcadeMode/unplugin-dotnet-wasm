import js from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  {
    ignores: [
      'node_modules',
      '**/dist',
      '**/bin',
      '**/obj',
      '**/.tmp-test',
      'wwwroot/_framework',
      'test-results',
      'coverage',
    ],
  },
  {
    files: [
      'scripts/**/*.{js,mjs,cjs}',
      'test/integration/**/*.{js,mjs,cjs}',
      'test/fixtures/**/*.{js,mjs,cjs}',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        import: 'readonly',
      },
    },
    rules: js.configs.recommended.rules,
  },
  eslintPluginPrettierRecommended,
];
