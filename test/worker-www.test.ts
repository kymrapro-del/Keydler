import { describe, expect, it } from 'vitest'
import worker from '../workers/www.js'

/**
 * Ce Worker remplace une Redirect Rule que le jeton de déploiement n'a pas le
 * droit de poser. Il ne fait qu'une chose, et ce qu'il garde tient à des
 * détails qui ne se voient pas à l'œil :
 *
 *   - le chemin et la requête doivent survivre. Un lien profond `/t/:id`
 *     renvoyé vers la racine ouvrirait une page vide ;
 *   - il ne doit pas se rediriger vers lui-même. Une route mal posée ferait
 *     une boucle infinie, et une boucle sur le domaine de production pendant
 *     le jugement d'un concours ne se rattrape pas ;
 *   - il ne doit jamais renvoyer vers `http:`.
 *
 * `wrangler dev --local` ne permet PAS de vérifier cela : il construit
 * `request.url` depuis l'adresse d'écoute et ignore l'en-tête `Host`, donc
 * toutes les requêtes lui parviennent comme venant de `127.0.0.1`. Une
 * première tentative de vérification par `curl -H Host:` a donné trois fois la
 * même réponse et n'a rien prouvé. D'où ces épreuves, qui appellent le
 * gestionnaire directement avec l'URL voulue.
 */
const appeler = (url: string): Response => worker.fetch(new Request(url)) as Response

describe('la redirection de www vers l’apex', () => {
  it('emmène le chemin et la requête avec elle', () => {
    // Le fragment n'apparaît pas ici : il n'est jamais envoyé au serveur, le
    // navigateur le reporte lui-même. C'est ce qui sauve un lien partagé, qui
    // porte le cahier entier dans son fragment.
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
    // Une route se déplace, et une redirection de l'apex vers l'apex serait
    // une boucle infinie sur le domaine de production.
    const r = appeler('https://keydler.com/t/abc')
    expect(r.status).not.toBe(301)
    expect(r.headers.get('location')).toBeNull()
  })

  it('répond 404 plutôt que de servir quoi que ce soit', () => {
    // Ce Worker n'a aucune liaison d'assets : s'il est atteint sur l'apex,
    // c'est que la route est fausse. Mieux vaut le dire que faire semblant.
    expect(appeler('https://keydler.com/').status).toBe(404)
  })
})

describe('les en-têtes de la redirection', () => {
  it('ne grave pas la redirection chez les visiteurs pour un an', () => {
    // Un 301 est mis en cache par les navigateurs même sans cette en-tête.
    // Ce montage est un contournement temporaire : pouvoir rebasculer sur www
    // si l'apex tombe vaut plus qu'un cache long, dont le gain est nul.
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
