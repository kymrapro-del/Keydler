import { describe, expect, it } from 'vitest'
import paquetBrut from '../package.json?raw'
import gabaritSw from '../public/sw.js?raw'
import gabaritHeaders from '../public/_headers?raw'

// `vite build` alone leaves a `dist/` that cannot be deployed: without `precache.mjs` (the
// fingerprinted names in the service worker) nor `headers.mjs` (the CSP sealed on the inline
// script hash), the CSP served carries `'__CSP_SCRIPT_HASH__'` and blocks the bootstrap script.
// None of this shows in `dist/`; `npm run check` has already left that very folder behind.
const paquet = JSON.parse(paquetBrut) as { scripts: Record<string, string> }
const scripts = paquet.scripts

const PRODUISENT_DIST = ['build', 'build:trial']

describe('les scripts qui produisent dist/', () => {
  it.each(PRODUISENT_DIST)('%s fait les deux substitutions', (nom) => {
    const script = scripts[nom]
    expect(script, nom).toContain('scripts/precache.mjs')
    expect(script, nom).toContain('scripts/headers.mjs')
  })

  it.each(PRODUISENT_DIST)('%s les fait APRÈS vite build', (nom) => {
    // Order is everything: substituting before building substitutes nothing.
    const script = scripts[nom]
    const construction = script.indexOf('vite build')
    expect(construction, nom).toBeGreaterThanOrEqual(0)
    expect(script.indexOf('scripts/precache.mjs'), nom).toBeGreaterThan(construction)
    expect(script.indexOf('scripts/headers.mjs'), nom).toBeGreaterThan(construction)
  })

  it('aucun autre script ne construit dist/ en contournant les substitutions', () => {
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
  it('ne laisse pas derrière lui un dist/ à moitié construit', () => {
    // It used to end with a bare `vite build`. A `dist/` that looked complete
    // stayed on disk, and nothing told that folder apart from a good one.
    expect(scripts.check).not.toMatch(/(^|&&\s*)(ALLOW_NO_ORIGIN_TRIAL=1 )?vite build\s*$/)
    expect(scripts.check).toContain('npm run build')
  })

  it('fait tourner le garde d’artefact', () => {
    expect(scripts.check).toContain('npm run artefact')
    expect(scripts.artefact).toContain('scripts/artefact.mjs')
  })
})

describe('les gabarits que la construction doit réécrire', () => {
  it('le service worker part d’un nom de cache reconnaissable comme non substitué', () => {
    // `artefact.mjs` refuses any name ending in `-dev`. If the template
    // changed to a normal looking name, the guard would no longer catch an
    // unsubstituted artefact going past.
    const cache = /const CACHE = '([^']*)'/.exec(gabaritSw)?.[1]
    expect(cache).toBeDefined()
    expect(cache!.endsWith('-dev')).toBe(true)
  })

  it('le service worker ne précharge aucun fichier empreinté avant substitution', () => {
    // The guard recognises a substituted artefact by SHELL citing files from
    // /assets/. If the template already cited some, it could no longer do so.
    const shell = /const SHELL = (\[[^\]]*\])/.exec(gabaritSw)?.[1] ?? ''
    expect([...shell.matchAll(/['"](\/assets\/[^'"]+)['"]/g)]).toHaveLength(0)
  })

  it('la politique part d’un marqueur, jamais d’une empreinte en dur', () => {
    // A hash written by hand in `public/_headers` would survive a missing
    // substitution with nothing to report it, and would silently drift from
    // the script actually built.
    expect(gabaritHeaders).toContain('__CSP_SCRIPT_HASH__')
    expect(gabaritHeaders).not.toMatch(/'sha256-[A-Za-z0-9+/=]+'/)
  })
})
