import { describe, expect, it } from 'vitest'
import rawPackage from '../package.json?raw'
import serviceWorkerTemplate from '../public/sw.js?raw'
import headersTemplate from '../public/_headers?raw'

// `vite build` alone leaves a `dist/` that cannot be deployed. Without
// `precache.mjs` for the fingerprinted names in the service worker and
// `headers.mjs` for the CSP sealed on the inline script hash, the served CSP
// carries `'__CSP_SCRIPT_HASH__'` and blocks the bootstrap script. It does not
// show in `dist/`, and `npm run check` once left exactly that folder behind.
const bundle = JSON.parse(rawPackage) as { scripts: Record<string, string> }
const scripts = bundle.scripts

const BUILDS_DIST = ['build', 'build:trial']

describe('the scripts that produce dist/', () => {
  it.each(BUILDS_DIST)('%s makes both substitutions', (name) => {
    const script = scripts[name]
    expect(script, name).toContain('scripts/precache.mjs')
    expect(script, name).toContain('scripts/headers.mjs')
  })

  it.each(BUILDS_DIST)('%s makes them AFTER vite build', (name) => {
    // Order is everything: substituting before building substitutes nothing.
    const script = scripts[name]
    const construction = script.indexOf('vite build')
    expect(construction, name).toBeGreaterThanOrEqual(0)
    expect(script.indexOf('scripts/precache.mjs'), name).toBeGreaterThan(construction)
    expect(script.indexOf('scripts/headers.mjs'), name).toBeGreaterThan(construction)
  })

  it('leaves no other script building dist/ around the substitutions', () => {
    const bypassing = Object.entries(scripts).filter(
      ([name, body]) =>
        name !== 'check' &&
        !BUILDS_DIST.includes(name) &&
        /(^|&&|\s)(ALLOW_NO_ORIGIN_TRIAL=1 )?(npx )?vite build/.test(body),
    )
    expect(bypassing.map(([name]) => name)).toEqual([])
  })
})

describe('npm run check', () => {
  it('leaves no half-built dist/ behind', () => {
    // It used to end with a bare `vite build`. A `dist/` that looked complete
    // stayed on disk, and nothing told that folder apart from a good one.
    expect(scripts.check).not.toMatch(/(^|&&\s*)(ALLOW_NO_ORIGIN_TRIAL=1 )?vite build\s*$/)
    expect(scripts.check).toContain('npm run build')
  })

  it('runs the artifact guard', () => {
    expect(scripts.check).toContain('npm run artifact')
    expect(scripts.artifact).toContain('scripts/artifact.mjs')
  })
})

describe('the templates the build must rewrite', () => {
  it('the service worker starts from a cache name recognisable as unsubstituted', () => {
    // `artifact.mjs` refuses any name ending in `-dev`. If the template changed
    // to a normal looking name, the guard would no longer catch an
    // unsubstituted artifact going past.
    const cache = /const CACHE = '([^']*)'/.exec(serviceWorkerTemplate)?.[1]
    expect(cache).toBeDefined()
    expect(cache!.endsWith('-dev')).toBe(true)
  })

  it('the service worker precaches no fingerprinted file before substitution', () => {
    // The guard recognises a substituted artifact by SHELL citing files from
    // /assets/. If the template already cited some, it could no longer do so.
    const shell = /const SHELL = (\[[^\]]*\])/.exec(serviceWorkerTemplate)?.[1] ?? ''
    expect([...shell.matchAll(/['"](\/assets\/[^'"]+)['"]/g)]).toHaveLength(0)
  })

  it('the policy starts from a marker, never from a hard-coded hash', () => {
    // A hash written by hand in `public/_headers` would survive a missing
    // substitution with nothing to report it, and would silently drift from the
    // script actually built.
    expect(headersTemplate).toContain('__CSP_SCRIPT_HASH__')
    expect(headersTemplate).not.toMatch(/'sha256-[A-Za-z0-9+/=]+'/)
  })
})
