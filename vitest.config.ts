import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // tests share process.env and temp state files
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // entry points only call `run()`
      exclude: ['src/run.ts', 'src/scripts/cache.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
