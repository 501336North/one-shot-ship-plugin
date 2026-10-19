import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Global setup file ensures clean state before each test
    setupFiles: ['./test/setup.ts'],
    // CRITICAL: Force single-threaded execution to avoid race conditions
    // Tests share global state like ~/.oss/current-project
    pool: 'forks',
    // vitest 4 replaced poolOptions.forks.singleFork with maxWorkers: 1 (one fork; files still isolated)
    maxWorkers: 1,
    // Run test FILES sequentially
    fileParallelism: false,
    // Run tests within each file sequentially
    sequence: {
      concurrent: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
