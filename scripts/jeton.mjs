// The payload of an origin trial token is plain JSON, only signed: what it
// allows can therefore be checked (structure: Chromium,
// `origin_trials_token_structure.md`). The origin includes scheme and port
// (`https://keydler.com:443`), and Chrome checks OFFLINE, reporting nothing: a
// token taken for `www.` or `http://` fails silently. The signature is not
// verified, for want of a public key; the risk is the wrong origin.

/**
 * A token is bound to an EXACT origin: keydler.com and keydler.pages.dev, the
 * fallback surface, each need one. Chrome reads every tag and keeps the one
 * that matches, so carrying them all costs nothing.
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
    // `isSubdomain` omitted means false: subdomain coverage has to be asked for
    // explicitly at sign-up, it is never implicit.
    sousDomaines: charge.isSubdomain === true,
    tiers: charge.isThirdParty === true,
    expire: typeof charge.expiry === 'number' ? new Date(charge.expiry * 1000) : null,
  }
}
