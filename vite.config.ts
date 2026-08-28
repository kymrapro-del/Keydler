import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
// @ts-expect-error — module de construction en JavaScript simple, partagé avec les épreuves.
import { tokensDe } from './scripts/jeton.mjs'

/**
 * Sans jeton, le greffon ne faisait rien — silencieusement. Une variable
 * d'environnement mal orthographiée chez l'hébergeur produisait donc un site
 * d'apparence saine où `document.modelContext` n'existe jamais, et où la seule
 * chose que voit un juge est « WebMCP is not available in this browser ».
 * Toutes les vérifications restaient vertes.
 *
 * Un jeton d'origin trial n'est pas un secret : il est imprimé tel quel dans
 * le HTML servi. Le taire n'apportait rien ; échouer fort apporte tout.
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
      // Jamais par défaut : `npm run build` est ce que les hébergeurs
      // détectent tout seuls, et la carte de source pesait 519 ko — plus que
      // tout le reste du site réuni. Elle rend aussi la source entière lisible
      // par un agent qui pilote le navigateur, ce que les campagnes de mesure
      // supposent impossible. `SOURCEMAP=1` la redemande.
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
