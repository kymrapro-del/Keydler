// `keydler.com` and `www.keydler.com` are two ORIGINS: storage is
// partitioned by origin and the origin trial token only enables WebMCP on
// the right one. A Redirect Rule would be simpler, but this deployment token
// only has `workers_routes`, not ruleset writes (403). The Worker serves no
// file: nothing would guarantee that the CSP in `_headers` survives an assets
// binding. The fragment, carried over by the browser, survives the hop.
const CANONIQUE = 'keydler.com'

export default {
  fetch(request) {
    const url = new URL(request.url)

    // This Worker is only mounted on www, but a route moves: reached from the
    // apex, redirecting would loop forever.
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
        // A 301 is cached even without this header. One hour tempers it:
        // this mount is temporary, and being able to switch back to www if
        // the apex goes down beats a redirect carved into the
        // visitors' caches.
        'cache-control': 'public, max-age=3600',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
