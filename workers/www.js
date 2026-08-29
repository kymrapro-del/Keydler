/**
 * `keydler.com` et `www.keydler.com` sont deux ORIGINES. Tout ce que ce
 * produit garde est cloisonné par origine — la base IndexedDB, le thème, le
 * canal entre onglets, le cache du service worker — et le jeton d'origin trial
 * est lié à une origine exacte : sur la mauvaise, WebMCP ne s'active pas et un
 * juge lit « WebMCP is not available in this browser ».
 *
 * La redirection se pose normalement par une Redirect Rule dans le tableau de
 * bord. Ce jeton de déploiement n'a pas le droit d'écriture sur les rulesets
 * (403), mais il a `workers_routes`. Ce Worker tient donc la place.
 *
 * Il ne sert aucun fichier et n'a aucune liaison : il répond une redirection,
 * et rien d'autre. C'est délibéré. Servir les fichiers depuis un script
 * imposerait de passer par une liaison d'assets, et rien ne garantirait que la
 * politique de sécurité définie dans `_headers` survive au passage — c'est
 * exactement le genre de perte qui ne se voit pas.
 *
 * Le fragment n'est jamais envoyé au serveur : le navigateur le reporte
 * lui-même sur l'URL de destination. Un lien partagé, qui porte le cahier
 * entier dans son fragment, survit donc à la redirection.
 */
const CANONIQUE = 'keydler.com'

export default {
  fetch(request) {
    const url = new URL(request.url)

    // Ce Worker n'est monté que sur www, mais une route se déplace : si on
    // l'atteint depuis l'apex, rediriger bouclerait indéfiniment.
    if (url.hostname === CANONIQUE) {
      return new Response('This host is served elsewhere.', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    url.hostname = CANONIQUE
    url.protocol = 'https:'
    url.port = ''

    return new Response(null, {
      status: 301,
      headers: {
        location: url.toString(),
        // Une redirection 301 est mise en cache par les navigateurs même sans
        // cette en-tête. Une heure la tempère délibérément : ce montage est un
        // contournement temporaire, et pendant le jugement du concours, garder
        // la possibilité de rebasculer sur www en cas de panne de l'apex vaut
        // davantage qu'une redirection définitivement gravée chez les
        // visiteurs. Le gain de performance d'un cache long est nul ici.
        'cache-control': 'public, max-age=3600',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
