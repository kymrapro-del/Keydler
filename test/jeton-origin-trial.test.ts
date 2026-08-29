import { describe, expect, it } from 'vitest'
import { lireJeton, tokensDe } from '../scripts/jeton.mjs'

// Without an origin trial token, `document.modelContext` does not exist and a judge reads “WebMCP
// is not available in this browser”. Chrome checks it OFFLINE, on the device: no alert, no
// catching up after the deploy freeze. The payload is plain JSON, hence readable: the tokens
// below are fabricated, a false origin not being obtainable any other way.

// Web API rather than `Buffer`: the repo has no `@types/node`, and does not want
// one for three lines of test.
const enBase64 = (octets: Uint8Array) => btoa(String.fromCharCode(...octets))
const depuisBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function fabriquer(charge: Record<string, unknown>, version = 3): string {
  const utile = new TextEncoder().encode(JSON.stringify(charge))
  const octets = new Uint8Array(69 + utile.length)
  octets[0] = version
  // Bytes 1..64 are the Ed25519 signature; we do not check it, and without
  // Chrome's public key that would mean nothing anyway.
  new DataView(octets.buffer).setUint32(65, utile.length, false)
  octets.set(utile, 69)
  return enBase64(octets)
}

const DANS_UN_AN = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
const VALIDE = { origin: 'https://keydler.com:443', feature: 'WebMCP', expiry: DANS_UN_AN }

describe('reading a token', () => {
  it('returns the origin, the feature and the expiry', () => {
    const j = lireJeton(fabriquer(VALIDE))
    expect(j.error).toBeUndefined()
    expect(j.origine).toBe('https://keydler.com:443')
    expect(j.fonctionnalite).toBe('WebMCP')
    // `expire` is null on a payload with no date: asserting it first fails
    // here rather than on the next line, with a better message.
    expect(j.expire).toBeInstanceOf(Date)
    expect(j.expire?.getTime()).toBe(DANS_UN_AN * 1000)
  })

  it('reads version 2 as well', () => {
    expect(lireJeton(fabriquer(VALIDE, 2)).fonctionnalite).toBe('WebMCP')
  })

  it('treats a missing `isSubdomain` as false', () => {
    // Subdomain coverage has to be asked for explicitly at registration.
    // Assuming it comes for free would suggest that a token for keydler.com
    // covers www.keydler.com. It does not cover it.
    expect(lireJeton(fabriquer(VALIDE)).sousDomaines).toBe(false)
    expect(lireJeton(fabriquer({ ...VALIDE, isSubdomain: true })).sousDomaines).toBe(true)
  })

  it('flags a “third-party” token', () => {
    // Those are only good injected from a third-party script. In a page's own
    // HTML they activate nothing, and say nothing.
    expect(lireJeton(fabriquer({ ...VALIDE, isThirdParty: true })).tiers).toBe(true)
  })
})

describe('what reading refuses', () => {
  const mauvais: [string, string][] = [
    ['text that is not a token', 'not-a-token'],
    ['an empty string', ''],
    ['a truncated token', fabriquer(VALIDE).slice(0, 40)],
  ]

  it.each(mauvais)('refuses %s', (_nom, value) => {
    expect(lireJeton(value).error).toBeDefined()
  })

  it('refuses an unknown version', () => {
    expect(lireJeton(fabriquer(VALIDE, 9)).error).toMatch(/version/)
  })

  it('refuses an inconsistent payload length', () => {
    const octets = depuisBase64(fabriquer(VALIDE))
    new DataView(octets.buffer).setUint32(65, 9_999, false)
    expect(lireJeton(enBase64(octets)).error).toMatch(/longueur/)
  })
})

describe('reading the environment variable', () => {
  it('accepts several tokens, separated by comma or newline', () => {
    // One origin, one token: keydler.com and keydler.pages.dev are two of them.
    // Chrome reads every tag and keeps the one that matches.
    expect(tokensDe('a,b')).toEqual(['a', 'b'])
    expect(tokensDe('a\nb')).toEqual(['a', 'b'])
    expect(tokensDe('  a , b  ')).toEqual(['a', 'b'])
  })

  it('makes no empty token out of nothing', () => {
    // A `content=""` tag would be worse than no tag at all: it would give the
    // impression that the token is in place.
    for (const rien of [undefined, '', '   ', ',', '\n,\n']) {
      expect(tokensDe(rien), JSON.stringify(rien)).toEqual([])
    }
  })
})
