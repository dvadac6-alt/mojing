import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    // Only lint first-party source; node_modules / dist / build outputs are skipped.
    ignores: ['dist/**', 'release/**', 'backend/**', 'node_modules/**', 'electron/**', '墨境数据/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The project uses many browser globals injected by the Electron preload
      // (window.mojingDesktop); keep no-undef lenient to avoid false positives.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
