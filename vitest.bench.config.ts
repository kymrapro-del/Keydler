import { defineConfig } from 'vitest/config'

/**
 * Le banc d'essai est tenu à l'écart de `npm test` : il dure des minutes, et
 * une durée n'est pas une assertion — un seuil de temps dans la suite se met à
 * clignoter au premier poste chargé. Ce que le banc trouve devient, lui, un
 * test ordinaire : une borne de nœuds, un compte de tokens, une liste bornée.
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
