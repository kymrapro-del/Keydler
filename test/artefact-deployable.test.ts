import { describe, expect, it } from 'vitest'
import paquetBrut from '../package.json?raw'
import gabaritSw from '../public/sw.js?raw'
import gabaritHeaders from '../public/_headers?raw'

// `vite build` alone leaves a `dist/` that cannot be deployed: without
// `precache.mjs` (the fingerprinted names in the service worker) nor
// `headers.mjs` (the CSP sealed on the inline script hash), the CSP served
// carries `'__CSP_SCRIPT_HASH__'` and blocks the bootstrap script. None of this
// shows in `dist/`; `npm run check` has already left that very folder behind.
const paquet = JSON.parse(paquetBrut) as { scripts: Record<string, string> }
const scripts = paquet.scripts

const PRODUISENT_DIST = ['build', 'build:trial']

describe('the scripts that produce dist/', () => {
  it.each(PRODUISENT_DIST)('%s makes both substitutions', (nom) => {
    const script = scripts[nom]
    expect(script, nom).toContain('scripts/precache.mjs')
    expect(script, nom).toContain('scripts/headers.mjs')
  })

  it.each(PRODUISENT_DIST)('%s makes them AFTER vite build', (nom) => {
    // Order is everything: substituting before building substitutes nothing.
    const script = scripts[nom]
    const construction = script.indexOf('vite build')
    expect(construction, nom).toBeGreaterThanOrEqual(0)
    expect(script.indexOf('scripts/precache.mjs'), nom).toBeGreaterThan(construction)
    expect(script.indexOf('scripts/headers.mjs'), nom).toBeGreaterThan(construction)
  })

  it('leaves no other script building dist/ around the substitutions', () => {
    const contournent = Object.entries(scripts).filter(
      ([nom, corps]) =>
        nom !== 'check' &&
        !PRODUISENT_DIST.includes(nom) &&
        /(^|&&|\s)(ALLOW_NO_ORIGIN_TRIAL=1 )?(npx )?vite build/.test(corps),
    )
    expect(contournent.map(([nom]) => nom)).toEqual([])
  })
})

describe('npm run check', () => {
  it('leaves no half-built dist/ behind', () => {
    // It used to end with a bare `vite build`. A `dist/` that looked complete
    // stayed on disk, and nothing told that folder apart from a good one.
    expect(scripts.check).not.toMatch(/(^|&&\s*)(ALLOW_NO_ORIGIN_TRIAL=1 )?vite build\s*$/)
    expect(scripts.check).toContain('npm run build')
  })

  it('runs the artefact guard', () => {
    expect(scripts.check).toContain('npm run artefact')
    expect(scripts.artefact).toContain('scripts/artefact.mjs')
  })
})

describe('the templates the build must rewrite', () => {
  it('the service worker starts from a cache name recognisable as unsubstituted', () => {
    // `artefact.mjs` refuses any name ending in `-dev`. If the template changed
    // to a normal looking name, the guard would no longer catch an
    // unsubstituted artefact going past.
    const cache = /const CACHE = '([^']*)'/.exec(gabaritSw)?.[1]
    expect(cache).toBeDefined()
    expect(cache!.endsWith('-dev')).toBe(true)
  })

  it('the service worker precaches no fingerprinted file before substitution', () => {
    // The guard recognises a substituted artefact by SHELL citing files from
    // /assets/. If the template already cited some, it could no longer do so.
    const shell = /const SHELL = (\[[^\]]*\])/.exec(gabaritSw)?.[1] ?? ''
    expect([...shell.matchAll(/['"](\/assets\/[^'"]+)['"]/g)]).toHaveLength(0)
  })

  it('the policy starts from a marker, never from a hard-coded hash', () => {
    // A hash written by hand in `public/_headers` would survive a missing
    // substitution with nothing to report it, and would silently drift from the
    // script actually built.
    expect(gabaritHeaders).toContain('__CSP_SCRIPT_HASH__')
    expect(gabaritHeaders).not.toMatch(/'sha256-[A-Za-z0-9+/=]+'/)
  })
})
