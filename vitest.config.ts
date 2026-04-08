import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['extensions/pi-var/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', '**/node_modules/**/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.d.ts', '**/*.test.ts'],
    },
  },
  resolve: {
    // Support .js extension imports that map to .ts files
    conditions: ['import', 'node'],
  },
});
