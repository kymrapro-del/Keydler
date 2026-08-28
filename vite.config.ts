import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

function originTrialMeta(token: string | undefined): Plugin {
  return {
    name: 'webmcp-origin-trial',
    transformIndexHtml(html) {
      if (!token) return html
      const sûr = token.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      const meta = `<meta http-equiv="origin-trial" content="${sûr}" />`
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
