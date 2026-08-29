import { describe, expect, it } from 'vitest'
import worker from '../workers/www.js'

// This Worker replaces a Redirect Rule the deploy token is not allowed to set.
// `wrangler dev --local` does NOT let you check it: it builds `request.url` from
// the listening address and ignores the `Host` header, so everything reaches it as
// coming from `127.0.0.1`. Hence these direct calls to the handler, with the URL we want.
const appeler = (url: string): Response => worker.fetch(new Request(url)) as Response

describe('la redirection de www vers l’apex', () => {
  it('emmène le chemin et la requête avec elle', () => {
    // The fragment does not show up here: it is never sent to the server, the
    // browser carries it over itself. That is what saves a shared link, which
    // carries the whole log in its fragment.
    const r = appeler('https://www.keydler.com/t/abf4be0acb7c?source=chat')
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toBe('https://keydler.com/t/abf4be0acb7c?source=chat')
  })

  it('redirige aussi la racine', () => {
    expect(appeler('https://www.keydler.com/').headers.get('location')).toBe('https://keydler.com/')
  })

  it('force https même si on l’atteint en clair', () => {
    const r = appeler('http://www.keydler.com/t/abc')
    expect(r.headers.get('location')).toBe('https://keydler.com/t/abc')
  })

  it('n’expose pas de port', () => {
    expect(appeler('https://www.keydler.com:8443/x').headers.get('location')).toBe(
      'https://keydler.com/x',
    )
  })
})

describe('le garde contre la boucle', () => {
  it('ne redirige PAS l’apex vers lui-même', () => {
    // A route moves, and a redirect from the apex to the apex would be an
    // infinite loop on the production domain.
    const r = appeler('https://keydler.com/t/abc')
    expect(r.status).not.toBe(301)
    expect(r.headers.get('location')).toBeNull()
  })

  it('répond 404 plutôt que de servir quoi que ce soit', () => {
    // This Worker has no asset binding: if it is reached on the apex, the
    // route is wrong. Better to say so than to pretend.
    expect(appeler('https://keydler.com/').status).toBe(404)
  })
})

describe('les en-têtes de la redirection', () => {
  it('ne grave pas la redirection chez les visiteurs pour un an', () => {
    // A 301 is cached by browsers even without this header.
    // This setup is a temporary workaround: being able to switch back to www
    // if the apex goes down is worth more than a long cache, whose gain is nil.
    const cache = appeler('https://www.keydler.com/').headers.get('cache-control') ?? ''
    const duree = Number(/max-age=(\d+)/.exec(cache)?.[1] ?? -1)
    expect(duree).toBeGreaterThan(0)
    expect(duree).toBeLessThanOrEqual(86_400)
  })

  it('ne fuite pas l’URL d’origine vers la destination', () => {
    expect(appeler('https://www.keydler.com/t/abc').headers.get('referrer-policy')).toBe(
      'no-referrer',
    )
  })
})
