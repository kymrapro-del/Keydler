/**
 * `keydler.com` et `www.keydler.com` sont deux ORIGINES, et tout ce que ce
 * produit garde est cloisonné par origine : la base IndexedDB, la préférence de
 * thème, « pendant votre absence », le canal entre onglets, le cache du service
 * worker. Un cahier créé sur l'une est invisible depuis l'autre, et un lien
 * `/t/:id` fabriqué ici ouvre une page vide là-bas.
 *
 * Pire pour ce que fait ce produit : le jeton d'origin trial est lié à une
 * origine exacte. Sur la mauvaise, WebMCP ne s'active pas du tout, et un juge
 * lit « WebMCP is not available in this browser ».
 *
 * La redirection se pose normalement chez l'hébergeur. Mais Cloudflare Pages ne
 * fait pas correspondre l'hôte dans `_redirects` — il faut une règle de
 * redirection posée à la main dans le tableau de bord — et une règle oubliée ne
 * se voit pas : les deux adresses répondent, chacune avec ses données, et rien
 * ne le signale. Ces quelques lignes sont donc le seul garde-fou entièrement
 * sous le contrôle du dépôt.
 *
 * Elles ne remplacent pas la règle d'hébergeur : une redirection 301 arrive
 * avant que la page ne soit chargée, celle-ci après. Elles garantissent
 * seulement qu'on ne FINIT pas sur la mauvaise origine.
 */
const CANONIQUE = 'keydler.com'

export function redirectToCanonical(location: Location = window.location): boolean {
  const hôte = location.hostname
  if (hôte !== `www.${CANONIQUE}`) return false

  // Le fragment voyage avec : il porte parfois un cahier entier.
  location.replace(`https://${CANONIQUE}${location.pathname}${location.search}${location.hash}`)
  return true
}
