import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['public/sw.js'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.serviceworker } },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The bench exists only to print measurements.
    files: ['bench/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Cloudflare Workers: neither browser nor Node. They have the standard web
    // interfaces (Request, Response, URL) and no DOM, no `document`.
    files: ['workers/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { Request: 'readonly', Response: 'readonly', URL: 'readonly' },
    },
  },
  {
    // Scripts de construction : Node, pas navigateur.
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
)
