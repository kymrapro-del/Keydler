// The payload of an origin trial token is plain JSON, only signed: what it
// allows can therefore be checked (structure: Chromium,
// `origin_trials_token_structure.md`). The origin includes scheme and port
// (`https://keydler.com:443`), and Chrome checks offline, reporting nothing: a
// token taken for `www.` or `http://` fails silently. The signature is not
// verified, for want of a public key; the risk is the wrong origin.

/**
 * A token is bound to an exact origin, so keydler.com and keydler.pages.dev,
 * the fallback surface, each need one. Chrome reads every tag and keeps the one
 * that matches, so carrying them all costs nothing.
 */
export function tokensFrom(raw) {
  return (raw ?? '')
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

export function readToken(base64) {
  let bytes
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return { error: 'not valid base64' }
  }
  if (bytes.length < 70) return { error: `too short (${bytes.length} bytes)` }

  const version = bytes[0]
  if (version !== 2 && version !== 3) {
    return { error: `unknown version (${version}), expected 2 or 3` }
  }

  const length = bytes.readUInt32BE(65)
  if (length === 0 || 69 + length > bytes.length) {
    return { error: `inconsistent payload length (${length})` }
  }

  let payload
  try {
    payload = JSON.parse(bytes.subarray(69, 69 + length).toString('utf8'))
  } catch {
    return { error: 'unreadable payload bytes' }
  }

  return {
    version,
    origin: payload.origin,
    feature: payload.feature,
    // `isSubdomain` omitted means false: subdomain coverage has to be asked for
    // explicitly at sign-up, it is never implicit.
    subdomains: payload.isSubdomain === true,
    thirdParty: payload.isThirdParty === true,
    expires: typeof payload.expiry === 'number' ? new Date(payload.expiry * 1000) : null,
  }
}
