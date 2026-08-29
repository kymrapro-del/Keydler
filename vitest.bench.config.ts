import { defineConfig } from 'vitest/config'

/**
 * The bench is kept out of `npm test`: it takes minutes, and a duration is not
 * an assertion. A time threshold in the suite starts flickering on the first
 * loaded machine. What the bench finds becomes an ordinary test instead: a node
 * bound, a token count, a bounded list.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    css: true,
    setupFiles: ['./test/setup.ts'],
    include: ['bench/**/*.bench.ts'],
    testTimeout: 300_000,
  },
})
