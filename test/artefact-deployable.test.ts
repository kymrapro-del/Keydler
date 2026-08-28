import { describe, expect, it } from 'vitest'
import paquetBrut from '../package.json?raw'
import gabaritSw from '../public/sw.js?raw'
import gabaritHeaders from '../public/_headers?raw'

/**
 * `vite build` produit les bons fichiers aux bons noms — et un dossier qui
 * n'est pas déployable. Deux substitutions se font après lui :
 * `precache.mjs` écrit les noms empreintés réellement construits dans le
 * service worker, `headers.mjs` scelle la CSP sur l'empreinte du script en
 * ligne.
 *
 * Sans elles, la CSP servie porte `'__CSP_SCRIPT_HASH__'` — pas une source
 * valide, donc le script d'amorce est bloqué — et le service worker ne
 * précharge rien sous un nom de cache fixe qui ne s'invalide jamais. Rien de
 * cela ne se voit en regardant `dist/`.
 *
 * C'est arrivé : `npm run check` se terminait par un `vite build` nu et
 * laissait exactement ce dossier-là derrière lui, prêt à être déployé par
 * quelqu'un de pressé. Ces épreuves tiennent l'invariant du côté du dépôt ;
 * `scripts/artefact.mjs` le tient du côté de l'artefact.
 */
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
    // L'ordre est tout : substituer avant de construire ne substitue rien.
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
    // Il se terminait par `vite build` nu. Un `dist/` d'apparence complète
    // restait sur le disque, et rien ne distinguait ce dossier d'un bon.
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
    // `artefact.mjs` refuse tout nom finissant par `-dev`. Si le gabarit
    // changeait pour un nom d'apparence normale, le garde ne verrait plus
    // passer un artefact non substitué.
    const cache = /const CACHE = '([^']*)'/.exec(gabaritSw)?.[1]
    expect(cache).toBeDefined()
    expect(cache!.endsWith('-dev')).toBe(true)
  })

  it('le service worker ne précharge aucun fichier empreinté avant substitution', () => {
    // Le garde reconnaît un artefact substitué au fait que SHELL cite des
    // fichiers de /assets/. Si le gabarit en citait déjà, il ne le pourrait plus.
    const shell = /const SHELL = (\[[^\]]*\])/.exec(gabaritSw)?.[1] ?? ''
    expect([...shell.matchAll(/['"](\/assets\/[^'"]+)['"]/g)]).toHaveLength(0)
  })

  it('la politique part d’un marqueur, jamais d’une empreinte en dur', () => {
    // Une empreinte écrite à la main dans `public/_headers` survivrait à
    // l'absence de substitution sans que rien ne le signale, et dériverait
    // silencieusement du script réellement construit.
    expect(gabaritHeaders).toContain('__CSP_SCRIPT_HASH__')
    expect(gabaritHeaders).not.toMatch(/'sha256-[A-Za-z0-9+/=]+'/)
  })
})
