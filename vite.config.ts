import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { tokensDe } from './scripts/jeton.mjs'

/**
 * With no token the plugin did nothing, and said nothing. A misspelled
 * environment variable at the host produced a healthy-looking site where
 * `document.modelContext` never exists, and where all a judge sees is "WebMCP
 * is not available in this browser". Every check stayed green.
 *
 * An origin trial token is not a secret: it is printed as-is in the served
 * HTML. Hiding it bought nothing. Failing loudly buys everything.
 */
function originTrialMeta(brut: string | undefined, production: boolean): Plugin {
  const tokens = tokensDe(brut)
  return {
    name: 'webmcp-origin-trial',
    buildStart() {
      if (production && tokens.length === 0) {
        this.error(
          'VITE_WEBMCP_ORIGIN_TRIAL_TOKEN est vide pour une construction de production.\n' +
            'Sans lui, WebMCP ne s’active que derrière chrome://flags, et rien ne le dira.\n' +
            'Enregistrez le jeton pour l’origine exacte servie, ou construisez avec\n' +
            'ALLOW_NO_ORIGIN_TRIAL=1 si c’est délibéré.',
        )
      }
    },
    transformIndexHtml(html) {
      if (tokens.length === 0) return html
      const balises = tokens
        .map((t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'))
        .map((t) => `<meta http-equiv="origin-trial" content="${t}" />`)
        .join('\n    ')
      const charset = html.match(/<meta\s+charset=[^>]*>/i)
      return charset
        ? html.replace(charset[0], () => `${charset[0]}\n    ${balises}`)
        : html.replace(/<head>/i, () => `<head>\n    ${balises}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [
      originTrialMeta(
        env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN,
        mode === 'production' && process.env.ALLOW_NO_ORIGIN_TRIAL !== '1',
      ),
    ],
    build: {
      target: 'es2022',
      // Never by default: `npm run build` is what hosts detect on their own,
      // and the source map weighed 519 KB, more than the rest of the site put
      // together. It also makes the whole source readable by an agent driving
      // the browser, which the measurement campaigns treat as impossible.
      // `SOURCEMAP=1` asks for it back.
      sourcemap: process.env.SOURCEMAP === '1',
    },
    test: {
      globals: true,
      environment: 'jsdom',
      css: true,
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'text'],
        exclude: ['src/main.ts', 'src/env.d.ts', '**/*.css'],
        include: ['src/**/*.ts'],
      },
    },
  }
})
