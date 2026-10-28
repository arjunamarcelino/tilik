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
      '**/generated/**', // Prisma-generated client (TS source under packages/db/src/generated)
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
  {
    // The API runtime must connect as the NON-OWNER tilik_app via PrismaService. getPrisma() binds the
    // OWNER DATABASE_URL and would silently defeat the append-only guarantee, so ban it (and the raw
    // client) everywhere under the API except the one file allowed to construct the client.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tilik/db',
              importNames: ['getPrisma', 'PrismaClient'],
              message:
                'Access the database only through PrismaService (non-owner tilik_app). getPrisma()/PrismaClient bind the owner connection and break append-only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/prisma/prisma.service.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier, // MUST be last — disables formatting rules that conflict with Prettier
);
