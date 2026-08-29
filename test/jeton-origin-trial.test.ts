import { describe, expect, it } from 'vitest'
import { lireJeton, tokensDe } from '../scripts/jeton.mjs'

// Sans jeton d'origin trial, `document.modelContext` n'existe pas et un juge lit « WebMCP is not
// available in this browser ». Chrome le vérifie HORS LIGNE, sur l'appareil : ni alerte, ni
// rattrapage après le gel des déploiements. La charge utile est du JSON en clair, donc lisible :
// les jetons ci-dessous sont fabriqués, une origine fausse ne s'obtenant pas autrement.

// API web plutôt que `Buffer` : le dépôt n'a pas `@types/node`, et n'en veut
// pas pour trois lignes d'épreuve.
const enBase64 = (octets: Uint8Array) => btoa(String.fromCharCode(...octets))
const depuisBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function fabriquer(charge: Record<string, unknown>, version = 3): string {
  const utile = new TextEncoder().encode(JSON.stringify(charge))
  const octets = new Uint8Array(69 + utile.length)
  octets[0] = version
  // Les octets 1..64 sont la signature Ed25519 ; on ne la vérifie pas, et
  // sans la clé publique de Chrome cela n'aurait aucun sens.
  new DataView(octets.buffer).setUint32(65, utile.length, false)
  octets.set(utile, 69)
  return enBase64(octets)
}

const DANS_UN_AN = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
const VALIDE = { origin: 'https://keydler.com:443', feature: 'WebMCP', expiry: DANS_UN_AN }

describe('la lecture d’un jeton', () => {
  it('rend l’origine, la fonctionnalité et l’expiration', () => {
    const j = lireJeton(fabriquer(VALIDE))
    expect(j.erreur).toBeUndefined()
    expect(j.origine).toBe('https://keydler.com:443')
    expect(j.fonctionnalite).toBe('WebMCP')
    // `expire` vaut null sur une charge utile sans date : l'affirmer d'abord
    // fait échouer ici plutôt qu'à la ligne suivante, avec un meilleur message.
    expect(j.expire).toBeInstanceOf(Date)
    expect(j.expire?.getTime()).toBe(DANS_UN_AN * 1000)
  })

  it('lit aussi la version 2', () => {
    expect(lireJeton(fabriquer(VALIDE, 2)).fonctionnalite).toBe('WebMCP')
  })

  it('tient `isSubdomain` absent pour faux', () => {
    // La couverture des sous-domaines est à demander explicitement à
    // l'inscription. La supposer acquise ferait croire qu'un jeton pour
    // keydler.com couvre www.keydler.com. Il ne le couvre pas.
    expect(lireJeton(fabriquer(VALIDE)).sousDomaines).toBe(false)
    expect(lireJeton(fabriquer({ ...VALIDE, isSubdomain: true })).sousDomaines).toBe(true)
  })

  it('signale un jeton « third-party »', () => {
    // Ceux-là ne valent qu'injectés depuis un script tiers. Dans le HTML
    // d'une page, ils n'activent rien, sans rien dire.
    expect(lireJeton(fabriquer({ ...VALIDE, isThirdParty: true })).tiers).toBe(true)
  })
})

describe('ce que la lecture refuse', () => {
  const mauvais: [string, string][] = [
    ['du texte qui n’est pas un jeton', 'pas-un-jeton'],
    ['une chaîne vide', ''],
    ['un jeton tronqué', fabriquer(VALIDE).slice(0, 40)],
  ]

  it.each(mauvais)('refuse %s', (_nom, valeur) => {
    expect(lireJeton(valeur).erreur).toBeDefined()
  })

  it('refuse une version inconnue', () => {
    expect(lireJeton(fabriquer(VALIDE, 9)).erreur).toMatch(/version/)
  })

  it('refuse une longueur de charge utile incohérente', () => {
    const octets = depuisBase64(fabriquer(VALIDE))
    new DataView(octets.buffer).setUint32(65, 9_999, false)
    expect(lireJeton(enBase64(octets)).erreur).toMatch(/longueur/)
  })
})

describe('la lecture de la variable d’environnement', () => {
  it('accepte plusieurs jetons, séparés par virgule ou saut de ligne', () => {
    // Une origine, un jeton : keydler.com et keydler.pages.dev en sont deux.
    // Chrome lit toutes les balises et retient celle qui correspond.
    expect(tokensDe('a,b')).toEqual(['a', 'b'])
    expect(tokensDe('a\nb')).toEqual(['a', 'b'])
    expect(tokensDe('  a , b  ')).toEqual(['a', 'b'])
  })

  it('ne fabrique pas de jeton vide à partir de rien', () => {
    // Une balise `content=""` serait pire qu'aucune balise : elle donnerait
    // à croire que le jeton est posé.
    for (const rien of [undefined, '', '   ', ',', '\n,\n']) {
      expect(tokensDe(rien), JSON.stringify(rien)).toEqual([])
    }
  })
})
