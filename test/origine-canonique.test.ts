import { describe, expect, it, vi } from 'vitest'
import { redirectToCanonical } from '../src/canonical'

// Deux origines pour un seul produit, c'est deux bases de données, deux caches
// et un jeton d'origin trial qui ne vaut que pour l'une. La règle se pose chez
// l'hébergeur, où une règle oubliée ne se voit pas : voici le garde-fou du dépôt.
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

describe('l’origine canonique', () => {
  it('renvoie www vers l’apex', () => {
    const l = faussseLocation('https://www.keydler.com/')
    expect(redirectToCanonical(l)).toBe(true)
    expect(l.replace).toHaveBeenCalledWith('https://keydler.com/')
  })

  it('emporte le chemin, la requête ET le fragment', () => {
    // Le fragment porte parfois un cahier entier : le perdre en route
    // transformerait un lien partagé en page vide.
    const l = faussseLocation('https://www.keydler.com/t/abc123?x=1#log=zAAAA')
    redirectToCanonical(l)
    expect(l.replace).toHaveBeenCalledWith('https://keydler.com/t/abc123?x=1#log=zAAAA')
  })

  it('ne touche pas à l’apex lui-même', () => {
    const l = faussseLocation('https://keydler.com/t/abc123')
    expect(redirectToCanonical(l)).toBe(false)
    expect(l.replace).not.toHaveBeenCalled()
  })

  it('ne touche pas au développement local', () => {
    // Sinon `npm run dev` renverrait vers la production à chaque chargement.
    for (const href of ['http://localhost:5173/', 'http://127.0.0.1:8921/t/x']) {
      const l = faussseLocation(href)
      expect(redirectToCanonical(l), href).toBe(false)
      expect(l.replace).not.toHaveBeenCalled()
    }
  })

  it('ne se laisse pas prendre par un hôte qui ressemble', () => {
    // `keydler.com.exemple.net` ou `wwwkeydler.com` ne sont pas nous, et une
    // redirection y serait au mieux inutile, au pire un renvoi obligeant.
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
