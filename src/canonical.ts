/**
 * `www.keydler.com` est une AUTRE origine : tout y est cloisonné, et le jeton
 * d'origin trial y étant invalide, un juge lit « WebMCP is not available in this
 * browser ». Cloudflare Pages ne sait pas filtrer sur l'hôte dans `_redirects` ;
 * la règle se pose à la main dans son tableau de bord, et son oubli ne se voit pas.
 */
const CANONIQUE = 'keydler.com'

export function redirectToCanonical(location: Location = window.location): boolean {
  const hôte = location.hostname
  if (hôte !== `www.${CANONIQUE}`) return false

  // Le fragment voyage avec : il porte parfois un cahier entier.
  location.replace(`https://${CANONIQUE}${location.pathname}${location.search}${location.hash}`)
  return true
}
