import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Pose le jeton d'origin trial dans le HTML produit, à la construction.
 *
 * Il était jusqu'ici uniquement injecté par script au démarrage, et l'API était
 * sondée dans la foulée. Or `document.modelContext` est un accesseur dont
 * l'existence se décide à l'analyse du document : un jeton arrivé après coup
 * peut ne rien débloquer, et la page rapporterait « pas d'API » sur une origine
 * pourtant autorisée. Le défaut ne se serait vu qu'après mise en ligne.
 *
 * Le `<meta>` figure donc dans le HTML initial, ce qui est la voie documentée.
 * L'injection par script demeure en second recours, pour un jeton fourni à
 * l'exécution.
 */
function originTrialMeta(token: string | undefined): Plugin {
  return {
    name: 'webmcp-origin-trial',
    transformIndexHtml(html) {
      if (!token) return html
      // Le jeton est échappé pour l'attribut : un guillemet le ferait sortir de
      // la balise. Et le remplacement passe par une fonction, faute de quoi
      // `String.replace` interpréterait `$&` ou `$'` dans le jeton comme des
      // motifs de substitution — silencieusement, à la construction.
      const sûr = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      const meta = `<meta http-equiv="origin-trial" content="${sûr}" />`
      // Juste après la déclaration d'encodage, qui doit rester en tête, et
      // avant toute balise de script : un jeton d'origin trial doit être lu le
      // plus tôt possible dans l'analyse du document.
      const charset = html.match(/<meta\s+charset=[^>]*>/i)
      return charset
        ? html.replace(charset[0], () => `${charset[0]}\n    ${meta}`)
        : html.replace(/<head>/i, () => `<head>\n    ${meta}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [originTrialMeta(env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN)],
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
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'text'],
        // `main.ts` n'est que l'accrochage au document et la lecture de l'URL ;
        // tout ce qui est testable en a été sorti vers `ui/bench.ts`.
        exclude: ['src/main.ts', 'src/env.d.ts', '**/*.css'],
        include: ['src/**/*.ts'],
      },
    },
  }
})
