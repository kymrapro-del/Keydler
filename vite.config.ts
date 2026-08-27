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
        exclude: ['src/main.ts', 'src/env.d.ts', '**/*.css'],
        include: ['src/**/*.ts'],
      },
    },
  }
})
