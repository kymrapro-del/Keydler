// La charge utile d'un jeton d'origin trial est du JSON en clair, seulement
// signée : on peut donc vérifier ce qu'elle autorise (structure : Chromium,
// `origin_trials_token_structure.md`). L'origine y inclut schéma et port
// (`https://keydler.com:443`), et Chrome vérifie HORS LIGNE, sans rien signaler :
// un jeton pris pour `www.` ou `http://` échoue en silence. La signature n'est
// pas vérifiée, faute de clé publique ; le risque est la mauvaise origine.

/**
 * Un jeton est lié à une origine EXACTE : keydler.com et keydler.pages.dev, la
 * surface de repli, en demandent chacune un. Chrome lit toutes les balises et
 * retient celle qui correspond, donc les porter toutes ne coûte rien.
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
