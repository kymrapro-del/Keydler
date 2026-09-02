import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import vercelBrut from '../vercel.json?raw'

// The page holds a vault of encrypted credentials and thirteen tools an agent
// can call, all of it reachable by an injected script. These hold the policy by
// its directives, which a rewrite weakens, and keep the two hosts aligned.
// Checked in Brave on `dist/`: inline script, CDN script, outbound `fetch`,
// image beacon and framing all refused, with no console error.
const vercel = JSON.parse(vercelBrut) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

const globales = vercel.headers.find((h) => h.source === '/(.*)')!
const vercelHeader = (name: string) =>
  globales.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? ''

const cspHeaders = /Content-Security-Policy:(.*)/.exec(headers)?.[1] ?? ''
const cspVercel = vercelHeader('Content-Security-Policy')

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `)) ?? ''

describe('the content security policy', () => {
  it('starts from nothing and opens only this origin, and Google Fonts', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'default-src')).toBe("default-src 'none'")
      for (const name of ['img-src', 'connect-src', 'manifest-src', 'worker-src']) {
        expect(directive(csp, name), name).toBe(`${name} 'self'`)
      }
    }
  })

  /**
   * The interface follows Material Design 3 and uses its typeface and icon
   * set, which are served by Google. Exactly two origins are opened for that,
   * one per directive, and neither carries anything executable : a stylesheet
   * host and a font host. `connect-src` stays `'self'`, so the application
   * still cannot send anything anywhere.
   */
  it('opens the two font origins and nothing more', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'style-src')).toBe("style-src 'self' https://fonts.googleapis.com")
      expect(directive(csp, 'font-src')).toBe('font-src https://fonts.gstatic.com')
      expect(directive(csp, 'connect-src')).toBe("connect-src 'self'")
    }
  })

  it('never allows `unsafe-inline` or `unsafe-eval`', () => {
    // The only inline script is allowed by its hash. `unsafe-inline` would
    // empty the policy in one word.
    for (const csp of [cspHeaders, cspVercel]) {
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('*')
    }
  })

  it('allows the bootstrap script by one hash, and only one', () => {
    // In the repo, `_headers` carries a marker: `scripts/headers.mjs` is what
    // computes the hash over the HTML actually built, substitutes it, and
    // refuses the build if `vercel.json` does not carry the same one.
    expect(directive(cspHeaders, 'script-src')).toBe("script-src 'self' '__CSP_SCRIPT_HASH__'")

    const dansVercel = cspVercel.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []
    expect(dansVercel).toHaveLength(1)
    expect(directive(cspVercel, 'script-src')).toBe(`script-src 'self' ${dansVercel[0]}`)
  })

  it('forbids framing, form submission and base rewriting', () => {
    for (const csp of [cspHeaders, cspVercel]) {
      expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
      expect(directive(csp, 'form-action')).toBe("form-action 'none'")
      expect(directive(csp, 'base-uri')).toBe("base-uri 'none'")
      expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    }
  })
})

describe('the other headers', () => {
  const expectedHeaders: [string, RegExp][] = [
    ['Strict-Transport-Security', /max-age=31536000/],
    ['X-Content-Type-Options', /^nosniff$/],
    ['X-Frame-Options', /^DENY$/],
    ['Referrer-Policy', /^no-referrer$/],
    ['Cross-Origin-Opener-Policy', /^same-origin$/],
    ['Cross-Origin-Resource-Policy', /^same-origin$/],
  ]

  it.each(expectedHeaders)('sets %s on both sides', (name, pattern) => {
    const fromFile = new RegExp(`${name}:\\s*(.*)`).exec(headers)?.[1]?.trim() ?? ''
    expect(fromFile, `_headers ${name}`).toMatch(pattern)
    expect(vercelHeader(name).trim(), `vercel.json ${name}`).toMatch(pattern)
  })

  it('refuses every permission the product does not use', () => {
    // None is used: no camera, no microphone, no location, no payment. Refusing
    // them costs nothing and removes that surface from a script that does
    // manage to run.
    for (const source of [headers, vercelHeader('Permissions-Policy')]) {
      for (const key of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial']) {
        expect(source, key).toContain(`${key}=()`)
      }
    }
  })

  it('caches only what carries a hash in its name', () => {
    // Caching `index.html` would serve an old page asking for files that have
    // been deleted: the classic white screen after a deployment.
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/)
    for (const f of ['/index.html', '/sw.js', '/manifest.webmanifest']) {
      // Other headers may sit between the path and its cache policy.
      expect(headers, f).toMatch(
        new RegExp(`${f}\\n(?:\\s+[\\w-]+:.*\\n)*?\\s+Cache-Control: no-cache, no-transform`),
      )
    }
  })

  /**
   * Cloudflare respects `no-transform` and leaves the strict CSP document
   * untouched instead of injecting a browser detection script.
   *
   * It belongs to the document paths and to nothing else. Workers assets
   * concatenate the `/*` rule with the more specific one rather than letting
   * the specific one win, and the served header came out as
   * `max-age=0, must-revalidate, no-transform, max-age=31536000, immutable`.
   * That leaked `no-transform` onto the hashed assets and stopped the edge
   * compressing them, and the first `max-age` won, so nothing was ever cached
   * for the year the second one asked for.
   */
  it('prevents edge transformations on documents, and only on documents', () => {
    expect(headers).toMatch(
      /\n\/\n(?:\s+[\w-]+:.*\n)*?\s+Cache-Control: public, max-age=0, must-revalidate, no-transform/,
    )

    const wildcard = headers.slice(headers.indexOf('\n/*\n')).split(/\n(?=\S)/)[0]
    expect(wildcard, 'no Cache-Control belongs on /*').not.toMatch(/Cache-Control/)
  })
})
