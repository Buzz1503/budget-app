// Lint covers the Health layer and its screens: the code added in stage 2.
// The rest of the app predates any linter and is left as it is.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'dist-native/**', 'ios/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['src/health/**/*.ts', 'src/body/**/*.ts', 'src/sauna/**/*.ts', 'src/sleep/**/*.ts'] })),
  {
    files: ['src/health/**/*.ts', 'src/body/**/*.ts', 'src/sauna/**/*.ts', 'src/sleep/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error', // no health values in logs
    },
  },
  {
    // stage 3B: the native snapshot, queue and notification schedule
    files: ['src/native/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        __NATIVE__: 'readonly', globalThis: 'readonly', document: 'readonly', URL: 'readonly', process: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'no-console': 'error', // nothing with health values in logs
    },
  },
  {
    files: ['src/health/**/*.js', 'src/sleep/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { __NATIVE__: 'readonly', globalThis: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    files: ['src/components/native/**/*.jsx', 'src/components/health/**/*.jsx', 'src/components/charts/**/*.jsx', 'src/components/charts/**/*.js', 'src/components/body/**/*.jsx', 'src/components/sauna/**/*.jsx', 'src/components/sauna/**/*.js', 'src/components/sleep/**/*.jsx', 'src/components/sleep/**/*.js', 'src/components/health/**/*.js', 'src/health/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', console: 'readonly',
        requestAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        localStorage: 'readonly', __NATIVE__: 'readonly', Worker: 'readonly', URL: 'readonly', Blob: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
]
