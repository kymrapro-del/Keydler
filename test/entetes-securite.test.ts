import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import vercelBrut from '../vercel.json?raw'

// The page holds a vault of encrypted credentials and thirteen tools an agent
// can call: an injected script would have access to all of it. The tests hold
// the policy by its DIRECTIVES, which rewriting it weakens, and keep the two
// hosts aligned. Checked in Brave on `dist/`: inline script, CDN script,
// outbound `fetch`, image beacon and framing all refused, without one console
// error.
const vercel = JSON.parse(vercelBrut) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

const globales = vercel.headers.find((h) => h.source === '/(.*)')!
const vercelHeader = (nom: string) =>
  globales.headers.find((h) => h.key.toLowerCase() === nom.toLowerCase())?.value ?? ''

const cspHeaders = /Content-Security-Policy:(.*)/.exec(headers)?.[1] ?? ''
const cspVercel = vercelHeader('Content-Security-Policy')

const directive = (csp: string, nom: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === nom || d.startsWith(`${nom} `)) ?? ''

describe('la politique de sécurité du contenu', () => {
  it('part de rien et n’ouvre que cette origine', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'default-src')).toBe("default-src 'none'")
      for (const nom of ['style-src', 'img-src', 'connect-src', 'manifest-src', 'worker-src']) {
        expect(directive(csp, nom), nom).toBe(`${nom} 'self'`)
      }
    }
  })

  it('n’autorise jamais ni `unsafe-inline` ni `unsafe-eval`', () => {
    // The only inline script is allowed by its hash. `unsafe-inline` would empty
    // the policy of its whole point in a single word.
    for (const csp of [cspHeaders, cspVercel]) {
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('*')
    }
  })

  it('autorise le script d’amorce par une empreinte, et une seule', () => {
    // In the repo, `_headers` carries a marker: `scripts/headers.mjs` is what
    // computes the hash over the HTML actually built, substitutes it, and
    // refuses the build if `vercel.json` does not carry the same one.
    expect(directive(cspHeaders, 'script-src')).toBe("script-src 'self' '__CSP_SCRIPT_HASH__'")

    const dansVercel = cspVercel.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []
    expect(dansVercel).toHaveLength(1)
    expect(directive(cspVercel, 'script-src')).toBe(`script-src 'self' ${dansVercel[0]}`)
  })

  it('interdit le cadrage, la soumission de formulaire et la réécriture de base', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
      expect(directive(csp, 'form-action')).toBe("form-action 'none'")
      expect(directive(csp, 'base-uri')).toBe("base-uri 'none'")
      expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    }
  })
})

describe('les autres en-têtes', () => {
  const attendus: [string, RegExp][] = [
    ['Strict-Transport-Security', /max-age=31536000/],
    ['X-Content-Type-Options', /^nosniff$/],
    ['X-Frame-Options', /^DENY$/],
    ['Referrer-Policy', /^no-referrer$/],
    ['Cross-Origin-Opener-Policy', /^same-origin$/],
    ['Cross-Origin-Resource-Policy', /^same-origin$/],
  ]

  it.each(attendus)('pose %s des deux côtés', (nom, motif) => {
    const fromFile = new RegExp(`${nom}:\\s*(.*)`).exec(headers)?.[1]?.trim() ?? ''
    expect(fromFile, `_headers ${nom}`).toMatch(motif)
    expect(vercelHeader(nom).trim(), `vercel.json ${nom}`).toMatch(motif)
  })

  it('refuse toutes les permissions que le produit n’utilise pas', () => {
    // None is used: the page asks for no camera, no microphone, no location,
    // no payment. Refusing them costs zero and takes that much surface away
    // from a script that would manage to run anyway.
    for (const source of [headers, vercelHeader('Permissions-Policy')]) {
      for (const key of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial']) {
        expect(source, key).toContain(`${key}=()`)
      }
    }
  })

  it('ne garde en cache que ce qui porte une empreinte', () => {
    // Caching `index.html` would serve an old page asking for files that have
    // been deleted: the classic white screen after a deployment.
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
    for (const f of ['/index.html', '/sw.js', '/manifest.webmanifest']) {
      expect(headers, f).toMatch(new RegExp(`${f}\\n\\s+Cache-Control: no-cache`))
    }
  })
})
