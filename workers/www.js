// `keydler.com` et `www.keydler.com` sont deux ORIGINES : le stockage est
// cloisonné par origine et le jeton d'origin trial n'active WebMCP que sur la
// bonne. Une Redirect Rule serait plus simple, mais ce jeton de déploiement n'a
// que `workers_routes`, pas l'écriture sur les rulesets (403). Le Worker ne sert
// aucun fichier : rien ne garantirait que la CSP de `_headers` survive à une
// liaison d'assets. Le fragment, reporté par le navigateur, survit au passage.
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
        // Une 301 est mise en cache même sans cette en-tête. Une heure la
        // tempère : ce montage est temporaire, et pouvoir rebasculer sur www en
        // cas de panne de l'apex vaut mieux qu'une redirection gravée chez les
        // visiteurs.
        'cache-control': 'public, max-age=3600',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
