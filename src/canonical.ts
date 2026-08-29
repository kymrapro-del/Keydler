/**
 * `www.keydler.com` is ANOTHER origin: everything there is partitioned, and the origin
 * trial token being invalid on it, a judge reads "WebMCP is not available in this
 * browser". Cloudflare Pages cannot filter on the host in `_redirects`; the rule is set
 * by hand in its dashboard, and forgetting it does not show.
 */
const CANONIQUE = 'keydler.com'

export function redirectToCanonical(location: Location = window.location): boolean {
  const host = location.hostname
  if (host !== `www.${CANONIQUE}`) return false

  // The fragment travels along: it sometimes carries a whole log.
  location.replace(`https://${CANONIQUE}${location.pathname}${location.search}${location.hash}`)
  return true
}
