import { describe, expect, it } from 'vitest'
import { readToken, tokensFrom } from '../scripts/token.mjs'

// Without an origin trial token, `document.modelContext` does not exist and the
// page reads "WebMCP is not available in this browser". Chrome checks offline,
// on the device: no alert, no catching up after the deploy freeze. The payload
// is plain JSON and readable, so the tokens below are fabricated; a false
// origin cannot be obtained any other way.

// Web API rather than `Buffer`: the repo has no `@types/node`, and does not
// want one for three lines of test.
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function fabricate(payload: Record<string, unknown>, version = 3): string {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const bytes = new Uint8Array(69 + payloadBytes.length)
  bytes[0] = version
  // Bytes 1..64 are the Ed25519 signature, not checked here: without Chrome's
  // public key it would mean nothing.
  new DataView(bytes.buffer).setUint32(65, payloadBytes.length, false)
  bytes.set(payloadBytes, 69)
  return toBase64(bytes)
}

const ONE_YEAR_FROM_NOW = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
const VALID = { origin: 'https://keydler.com:443', feature: 'WebMCP', expiry: ONE_YEAR_FROM_NOW }

describe('reading a token', () => {
  it('returns the origin, the feature and the expiry', () => {
    const j = readToken(fabricate(VALID))
    expect(j.error).toBeUndefined()
    expect(j.origin).toBe('https://keydler.com:443')
    expect(j.feature).toBe('WebMCP')
    // `expires` is null on a payload with no date: asserting it first fails here
    // rather than on the next line, with a better message.
    expect(j.expires).toBeInstanceOf(Date)
    expect(j.expires?.getTime()).toBe(ONE_YEAR_FROM_NOW * 1000)
  })

  it('reads version 2 as well', () => {
    expect(readToken(fabricate(VALID, 2)).feature).toBe('WebMCP')
  })

  it('treats a missing `isSubdomain` as false', () => {
    // Subdomain coverage has to be asked for explicitly at registration.
    // Assuming otherwise would suggest a token for keydler.com covers
    // www.keydler.com. It does not.
    expect(readToken(fabricate(VALID)).subdomains).toBe(false)
    expect(readToken(fabricate({ ...VALID, isSubdomain: true })).subdomains).toBe(true)
  })

  it('flags a “third-party” token', () => {
    // Those are only good injected from a third-party script. In a page's own
    // HTML they activate nothing, and say nothing.
    expect(readToken(fabricate({ ...VALID, isThirdParty: true })).thirdParty).toBe(true)
  })
})

describe('what reading refuses', () => {
  const invalid: [string, string][] = [
    ['text that is not a token', 'not-a-token'],
    ['an empty string', ''],
    ['a truncated token', fabricate(VALID).slice(0, 40)],
  ]

  it.each(invalid)('refuses %s', (_name, value) => {
    expect(readToken(value).error).toBeDefined()
  })

  it('refuses an unknown version', () => {
    expect(readToken(fabricate(VALID, 9)).error).toMatch(/version/)
  })

  it('refuses an inconsistent payload length', () => {
    const bytes = fromBase64(fabricate(VALID))
    new DataView(bytes.buffer).setUint32(65, 9_999, false)
    expect(readToken(toBase64(bytes)).error).toMatch(/length/)
  })
})

describe('reading the environment variable', () => {
  it('accepts several tokens, separated by comma or newline', () => {
    // One origin, one token: keydler.com and keydler.pages.dev are two of them.
    // Chrome reads every tag and keeps the one that matches.
    expect(tokensFrom('a,b')).toEqual(['a', 'b'])
    expect(tokensFrom('a\nb')).toEqual(['a', 'b'])
    expect(tokensFrom('  a , b  ')).toEqual(['a', 'b'])
  })

  it('makes no empty token out of nothing', () => {
    // A `content=""` tag would be worse than no tag at all: it would give the
    // impression that the token is in place.
    for (const empty of [undefined, '', '   ', ',', '\n,\n']) {
      expect(tokensFrom(empty), JSON.stringify(empty)).toEqual([])
    }
  })
})
