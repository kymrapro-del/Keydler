import { describe, expect, it, vi } from 'vitest'
import { redirectToCanonical } from '../src/canonical'

// Two origins for one product means two databases, two caches and an origin
// trial token that only holds for one of them. The rule is set at the host,
// where a forgotten rule cannot be seen: here is the repository's guard rail.
function faussseLocation(href: string) {
  const u = new URL(href)
  return {
    hostname: u.hostname,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    replace: vi.fn(),
  } as unknown as Location & { replace: ReturnType<typeof vi.fn> }
}

describe('the canonical origin', () => {
  it('sends www to the apex', () => {
    const l = faussseLocation('https://www.keydler.com/')
    expect(redirectToCanonical(l)).toBe(true)
    expect(l.replace).toHaveBeenCalledWith('https://keydler.com/')
  })

  it('carries the path, the query AND the fragment', () => {
    // The fragment sometimes carries a whole log: losing it on the way would
    // turn a shared link into an empty page.
    const l = faussseLocation('https://www.keydler.com/t/abc123?x=1#log=zAAAA')
    redirectToCanonical(l)
    expect(l.replace).toHaveBeenCalledWith('https://keydler.com/t/abc123?x=1#log=zAAAA')
  })

  it('leaves the apex itself alone', () => {
    const l = faussseLocation('https://keydler.com/t/abc123')
    expect(redirectToCanonical(l)).toBe(false)
    expect(l.replace).not.toHaveBeenCalled()
  })

  it('leaves local development alone', () => {
    // Otherwise `npm run dev` would redirect to production on every load.
    for (const href of ['http://localhost:5173/', 'http://127.0.0.1:8921/t/x']) {
      const l = faussseLocation(href)
      expect(redirectToCanonical(l), href).toBe(false)
      expect(l.replace).not.toHaveBeenCalled()
    }
  })

  it('is not fooled by a lookalike host', () => {
    // `keydler.com.exemple.net` and `wwwkeydler.com` are not us, and a
    // redirect there would be useless at best, a forced hop at worst.
    for (const href of [
      'https://keydler.com.exemple.net/',
      'https://wwwkeydler.com/',
      'https://www.keydler.com.evil.test/',
    ]) {
      const l = faussseLocation(href)
      expect(redirectToCanonical(l), href).toBe(false)
    }
  })
})
