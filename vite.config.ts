import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    target: 'es2022',
    // Les cartes de source reconstituent l'intégralité du code. Utiles en
    // production pour déboguer, elles ruinent l'isolement d'un essai d'agent :
    // une page qui les sert laisse lire seed.ts et tout le reste.
    sourcemap: process.env.TRIAL !== '1',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
})
