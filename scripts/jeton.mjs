/**
 * Un jeton d'origin trial n'est pas opaque : sa charge utile est du JSON en
 * clair, seulement signée. On peut donc VÉRIFIER ce qu'il autorise au lieu de
 * le croire sur parole — et c'est la seule chose qui décide si un juge voit
 * treize outils ou « WebMCP is not available in this browser ».
 *
 * Trois erreurs silencieuses qu'une lecture attrape et qu'un tableau de bord
 * ne signale pas :
 *
 *   - une origine qui ne correspond pas. Elle inclut le SCHÉMA et le PORT :
 *     `https://keydler.com:443`. Un jeton pris pour `www.` ou pour `http://`
 *     ne s'appliquera jamais, et Chrome n'en dira rien à personne ;
 *   - une fonctionnalité qui n'est pas la bonne ;
 *   - une expiration antérieure à la fin du jugement. Chrome vérifie le jeton
 *     HORS LIGNE, sur l'appareil : il n'y a ni rattrapage ni alerte, et rien
 *     ne pourra être corrigé après le gel des déploiements.
 *
 * Structure (source : Chromium, `origin_trials_token_structure.md`) :
 *   octet 0        version (2 ou 3)
 *   octets 1..64   signature Ed25519
 *   octets 65..68  longueur de la charge utile, entier 32 bits gros-boutiste
 *   au-delà        la charge utile, JSON UTF-8
 *
 * La signature n'est PAS vérifiée ici : sans la clé publique de Chrome cela
 * n'aurait pas de sens, et ce n'est pas le risque. Le risque est de déployer
 * un jeton valide pour la mauvaise origine.
 */
/**
 * Un jeton est lié à une origine EXACTE, schéma et port compris. Le site est
 * servi sur keydler.com, mais keydler.pages.dev reste une surface de repli, et
 * ce sont deux origines : il faut un jeton par origine. Chrome lit plusieurs
 * balises et retient celle qui correspond, donc les porter toutes ne coûte
 * rien. Séparateur : virgule ou saut de ligne.
 */
export function tokensDe(brut) {
  return (brut ?? '')
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

export function lireJeton(base64) {
  let octets
  try {
    octets = Buffer.from(base64, 'base64')
  } catch {
    return { erreur: 'ce n’est pas du base64' }
  }
  if (octets.length < 70) return { erreur: `trop court (${octets.length} octets)` }

  const version = octets[0]
  if (version !== 2 && version !== 3) {
    return { erreur: `version inconnue (${version}), 2 ou 3 attendues` }
  }

  const longueur = octets.readUInt32BE(65)
  if (longueur === 0 || 69 + longueur > octets.length) {
    return { erreur: `longueur de charge utile incohérente (${longueur})` }
  }

  let charge
  try {
    charge = JSON.parse(octets.subarray(69, 69 + longueur).toString('utf8'))
  } catch {
    return { erreur: 'charge utile illisible' }
  }

  return {
    version,
    origine: charge.origin,
    fonctionnalite: charge.feature,
    // `isSubdomain` omis vaut false : la couverture des sous-domaines est à
    // demander explicitement à l'inscription, elle n'est jamais implicite.
    sousDomaines: charge.isSubdomain === true,
    tiers: charge.isThirdParty === true,
    expire: typeof charge.expiry === 'number' ? new Date(charge.expiry * 1000) : null,
  }
}
