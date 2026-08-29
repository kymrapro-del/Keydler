import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { tokensFrom } from './scripts/token.mjs'

/**
 * With no token the plugin did nothing, and said nothing. A misspelled
 * environment variable at the host produced a healthy-looking site where
 * `document.modelContext` never exists, and where all a judge sees is "WebMCP
 * is not available in this browser". Every check stayed green.
 *
 * An origin trial token is not a secret: it is printed as-is in the served
 * HTML. Hiding it bought nothing. Failing loudly buys everything.
 */
function originTrialMeta(raw: string | undefined, production: boolean): Plugin {
  const tokens = tokensFrom(raw)
  return {
    name: 'webmcp-origin-trial',
    buildStart() {
      if (production && tokens.length === 0) {
        this.error(
          'VITE_WEBMCP_ORIGIN_TRIAL_TOKEN is empty for a production build.\n' +
            'Without it, WebMCP requires chrome://flags and the page cannot explain why.\n' +
            'Register a token for the exact served origin, or build with\n' +
            'ALLOW_NO_ORIGIN_TRIAL=1 when this is intentional.',
        )
      }
    },
    transformIndexHtml(html) {
      if (tokens.length === 0) return html
      const tags = tokens
        .map((t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'))
        .map((t) => `<meta http-equiv="origin-trial" content="${t}" />`)
        .join('\n    ')
      const charset = html.match(/<meta\s+charset=[^>]*>/i)
      return charset
        ? html.replace(charset[0], () => `${charset[0]}\n    ${tags}`)
        : html.replace(/<head>/i, () => `<head>\n    ${tags}`)
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
