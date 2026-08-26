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
      // En tête du `<head>`, avant toute balise de script : un jeton d'origin
      // trial doit être lu le plus tôt possible dans l'analyse du document.
      return html.replace(
        /<head>/,
        `<head>\n    <meta http-equiv="origin-trial" content="${token}" />`,
      )
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
    },
  }
})
