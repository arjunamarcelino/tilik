// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      'docs/**',
      '**/.venv/**',
      '**/__pycache__/**',
      '**/*.py',
      'services/**',
      'data/**',
      'infra/**',
    ],
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  },
  prettier, // MUST be last — disables formatting rules that conflict with Prettier
);
