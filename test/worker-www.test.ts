import { describe, expect, it } from 'vitest'
import worker from '../workers/www.js'

// This Worker replaces a Redirect Rule the deploy token is not allowed to set.
// `wrangler dev --local` does NOT let you check it: it builds `request.url` from
// the listening address and ignores the `Host` header, so everything reaches it as
// coming from `127.0.0.1`. Hence these direct calls to the handler, with the URL we want.
const appeler = (url: string): Response => worker.fetch(new Request(url)) as Response

describe('the redirect from www to the apex', () => {
  it('takes the path and the query along', () => {
    // The fragment does not show up here: it is never sent to the server, the
    // browser carries it over itself. That is what saves a shared link, which
    // carries the whole log in its fragment.
    const r = appeler('https://www.keydler.com/t/abf4be0acb7c?source=chat')
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toBe('https://keydler.com/t/abf4be0acb7c?source=chat')
  })

  it('redirects the root too', () => {
    expect(appeler('https://www.keydler.com/').headers.get('location')).toBe('https://keydler.com/')
  })

  it('forces https even when reached in the clear', () => {
    const r = appeler('http://www.keydler.com/t/abc')
    expect(r.headers.get('location')).toBe('https://keydler.com/t/abc')
  })

  it('exposes no port', () => {
    expect(appeler('https://www.keydler.com:8443/x').headers.get('location')).toBe(
      'https://keydler.com/x',
    )
  })
})

describe('the guard against the loop', () => {
  it('does NOT redirect the apex to itself', () => {
    // A route moves, and a redirect from the apex to the apex would be an
    // infinite loop on the production domain.
    const r = appeler('https://keydler.com/t/abc')
    expect(r.status).not.toBe(301)
    expect(r.headers.get('location')).toBeNull()
  })

  it('answers 404 rather than serving anything', () => {
    // This Worker has no asset binding: if it is reached on the apex, the
    // route is wrong. Better to say so than to pretend.
    expect(appeler('https://keydler.com/').status).toBe(404)
  })
})

describe('the redirect headers', () => {
  it('does not carve the redirect into visitors for a year', () => {
    // A 301 is cached by browsers even without this header.
    // This setup is a temporary workaround: being able to switch back to www
    // if the apex goes down is worth more than a long cache, whose gain is nil.
    const cache = appeler('https://www.keydler.com/').headers.get('cache-control') ?? ''
    const duree = Number(/max-age=(\d+)/.exec(cache)?.[1] ?? -1)
    expect(duree).toBeGreaterThan(0)
    expect(duree).toBeLessThanOrEqual(86_400)
  })

  it('does not leak the origin URL to the destination', () => {
    expect(appeler('https://www.keydler.com/t/abc').headers.get('referrer-policy')).toBe(
      'no-referrer',
    )
  })
})
