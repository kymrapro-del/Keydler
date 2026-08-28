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
function originTrialMeta(token: string | undefined, command: 'build' | 'serve'): Plugin {
  return {
    name: 'webmcp-origin-trial',
    transformIndexHtml(html) {
      if (!token) {
        // En développement (`vite`), le jeton est inutile — le drapeau
        // chrome://flags/#enable-webmcp-testing suffit en local, et le silence
        // ici évite un bruit permanent dans `npm run dev`.
        //
        // En build (`vite build`, `build:trial`), l'absence de jeton produit un
        // artefact qui SEMBLE correct — types bons, tests verts, page qui
        // s'affiche — mais où `document.modelContext` n'existera jamais sur
        // l'origine déployée. Ce défaut ne se serait vu qu'après mise en ligne,
        // devant un juge. Un avertissement bruyant sur la sortie du build est
        // le seul moment où quelqu'un qui déploie sans avoir lu la doc peut
        // encore le remarquer.
        if (command === 'build') {
          console.warn(
            [
              '',
              '\x1b[41m\x1b[97m ATTENTION \x1b[0m \x1b[1mAucun VITE_WEBMCP_ORIGIN_TRIAL_TOKEN au moment du build.\x1b[0m',
              '',
              "  Ce build produira une page qui s'affiche normalement mais où",
              "  document.modelContext n'existera jamais : aucun outil WebMCP ne sera",
              '  exposé sur cette origine. Le build ne va PAS échouer — voir',
              '  docs/deploiement.md pour comprendre pourquoi et comment poser le jeton.',
              '',
              '  Sans conséquence pour un build local ou un aperçu Vercel non lié au',
              '  domaine final : le jeton est lié à une origine exacte et ne peut de',
              '  toute façon pas y fonctionner.',
              '',
            ].join('\n'),
          )
        }
        return html
      }
      // Le jeton est échappé pour l'attribut : un guillemet le ferait sortir de
      // la balise. Et le remplacement passe par une fonction, faute de quoi
      // `String.replace` interpréterait `$&` ou `$'` dans le jeton comme des
      // motifs de substitution — silencieusement, à la construction.
      const sûr = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      const meta = `<meta http-equiv="origin-trial" content="${sûr}" />`
      const charset = html.match(/<meta\s+charset=[^>]*>/i)
      return charset
        ? html.replace(charset[0], () => `${charset[0]}\n    ${meta}`)
        : html.replace(/<head>/i, () => `<head>\n    ${meta}`)
    },
  }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [originTrialMeta(env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN, command)],
    build: {
      target: 'es2022',
      sourcemap: process.env.TRIAL !== '1',
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
