// Checks against the site as it REALLY IS ONLINE. The test suite runs in jsdom
// over source code; this project has paid for that four times already, green
// tests while a browser found the defect in a minute. We cover here what they
// cannot see (host headers, redirects, MIME types, caching, SPA fallback), and
// we exit non zero, so this script can serve as a gate.
const ORIGINE = process.argv[2] ?? 'https://keydler.com'
const seulementEchecs = process.argv.includes('--echecs')

const reussites = []
const echecs = []

const constats = []

function verifier(nom, condition, observe) {
  if (condition) reussites.push(nom)
  else echecs.push({ nom, observe })
}

/**
 * What we observe without being able to fix it: it has to show on every run,
 * but must not fail a gate, otherwise the gate becomes noise that everyone
 * ends up ignoring.
 */
function constater(nom, valeur, remarque) {
  constats.push({ nom, valeur, remarque })
}

const cache = new Map()
async function chercher(chemin, options = {}) {
  const clef = `${options.method ?? 'GET'} ${chemin}${options.redirect ?? ''}`
  if (cache.has(clef)) return cache.get(clef)
  const r = await fetch(`${ORIGINE}${chemin}`, { redirect: 'manual', ...options })
  const corps = options.method === 'HEAD' ? '' : await r.text()
  const resultat = { statut: r.status, entetes: r.headers, corps }
  cache.set(clef, resultat)
  return resultat
}

const entete = (r, nom) => r.entetes.get(nom) ?? ''
const directive = (csp, nom) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === nom || d.startsWith(`${nom} `)) ?? ''

// ----------------------------------------------------------------- the root
const racine = await chercher('/')

verifier('la racine répond 200', racine.statut === 200, racine.statut)
verifier(
  'la racine est du HTML',
  entete(racine, 'content-type').includes('text/html'),
  entete(racine, 'content-type'),
)
verifier('la racine porte un charset', /charset=utf-8/i.test(entete(racine, 'content-type')))

// ----------------------------------------------------------- security headers
const csp = entete(racine, 'content-security-policy')
verifier('une politique de sécurité du contenu est servie', csp.length > 0)
verifier("default-src part de 'none'", directive(csp, 'default-src') === "default-src 'none'", csp)
verifier(
  'frame-ancestors interdit le cadrage',
  directive(csp, 'frame-ancestors') === "frame-ancestors 'none'",
)
verifier(
  'form-action interdit la soumission',
  directive(csp, 'form-action') === "form-action 'none'",
)
verifier('base-uri est verrouillé', directive(csp, 'base-uri') === "base-uri 'none'")
verifier('object-src est verrouillé', directive(csp, 'object-src') === "object-src 'none'")
verifier("la politique n'autorise pas unsafe-inline", !csp.includes('unsafe-inline'))
verifier("la politique n'autorise pas unsafe-eval", !csp.includes('unsafe-eval'))
verifier('la politique ne contient aucun joker', !csp.includes('*'))
verifier(
  'le script en ligne est autorisé par empreinte, et une seule',
  (csp.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []).length === 1,
  csp.match(/'sha256-[A-Za-z0-9+/=]+'/g),
)
verifier(
  "l'empreinte de la politique est celle du script réellement servi",
  csp.includes(await empreinteDuScriptEnLigne(racine.corps)),
)

const attendus = [
  ['strict-transport-security', /max-age=31536000/, 'HSTS un an'],
  ['strict-transport-security', /includeSubDomains/, 'HSTS couvre les sous-domaines'],
  ['x-content-type-options', /^nosniff$/, 'le reniflage de type est refusé'],
  ['x-frame-options', /^DENY$/, 'le cadrage est refusé'],
  ['referrer-policy', /^no-referrer$/, "l'adresse d'origine ne fuit pas"],
  ['cross-origin-opener-policy', /^same-origin$/, 'la fenêtre est isolée'],
  ['cross-origin-resource-policy', /^same-origin$/, 'la ressource est isolée'],
]
for (const [nom, motif, libelle] of attendus) {
  verifier(libelle, motif.test(entete(racine, nom).trim()), entete(racine, nom))
}

const permissions = entete(racine, 'permissions-policy')
for (const capacite of [
  'camera',
  'microphone',
  'geolocation',
  'payment',
  'usb',
  'serial',
  'midi',
  'accelerometer',
  'gyroscope',
  'magnetometer',
  'autoplay',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'screen-wake-lock',
  'xr-spatial-tracking',
  'publickey-credentials-get',
]) {
  verifier(`la capacité ${capacite} est refusée`, permissions.includes(`${capacite}=()`))
}

verifier(
  "aucun en-tête ne nomme le logiciel serveur au-delà de l'hébergeur",
  !racine.corps.includes('X-Powered-By') && entete(racine, 'x-powered-by') === '',
)

// ----------------------------------------------------------------- the token
const jetons = [...racine.corps.matchAll(/http-equiv="origin-trial"\s+content="([^"]*)"/g)]
verifier('un jeton origin trial est servi', jetons.length >= 1, jetons.length)
if (jetons.length >= 1) {
  const { lireJeton } = await import('./jeton.mjs')
  const j = lireJeton(jetons[0][1])
  verifier('le jeton est lisible', !j.erreur, j.erreur)
  verifier(
    'le jeton porte la fonctionnalité WebMCP',
    j.fonctionnalite === 'WebMCP',
    j.fonctionnalite,
  )
  verifier(
    "le jeton est émis pour l'origine servie",
    String(j.origine ?? '').replace(/:443$/, '') === ORIGINE,
    j.origine,
  )
  verifier(
    "le jeton n'est pas expiré",
    j.expire !== null && j.expire.getTime() > Date.now(),
    j.expire,
  )
  verifier(
    'le jeton couvre encore la fin du jugement du concours',
    j.expire !== null && j.expire.getTime() > Date.parse('2026-09-21T23:59:59Z'),
    j.expire,
  )
  verifier("le jeton n'est pas un jeton tiers, qui n'activerait rien dans une page", !j.tiers)
}

// ------------------------------------------------------------------ the markup
verifier('la page déclare sa langue', /<html[^>]+lang="/.test(racine.corps))
verifier('la page a un titre', /<title>[^<]{10,70}<\/title>/.test(racine.corps))
verifier(
  "la page n'a QU'UNE balise description",
  (racine.corps.match(/name="description"/g) ?? []).length === 1,
  (racine.corps.match(/name="description"/g) ?? []).length,
)
verifier('la page déclare une adresse canonique', /rel="canonical"/.test(racine.corps))
verifier(
  "l'adresse canonique est l'apex en https",
  /rel="canonical"\s+href="https:\/\/keydler\.com\//.test(racine.corps),
)
for (const balise of [
  'og:title',
  'og:description',
  'og:url',
  'og:image',
  'og:type',
  'og:site_name',
]) {
  verifier(`la carte sociale porte ${balise}`, racine.corps.includes(`property="${balise}"`))
}
verifier('une carte Twitter est déclarée', racine.corps.includes('name="twitter:card"'))
verifier('un manifeste est déclaré', racine.corps.includes('rel="manifest"'))
verifier('une icône est déclarée', racine.corps.includes('rel="icon"'))
verifier('une couleur de thème est déclarée', racine.corps.includes('name="theme-color"'))
verifier('la page se dimensionne sur mobile', racine.corps.includes('name="viewport"'))

// -------------------------------------------------------------- discovery files
for (const [chemin, type, libelle] of [
  ['/robots.txt', 'text/plain', 'robots.txt'],
  ['/sitemap.xml', 'xml', 'sitemap.xml'],
  // Browsers and aggregators ask for it at the root without reading the HTML.
  // The SPA fallback handed them the home page as text/html.
  ['/favicon.ico', 'image/', 'favicon.ico'],
  ['/manifest.webmanifest', 'json', 'le manifeste'],
  ['/icons/icon.svg', 'svg', "l'icône"],
]) {
  const r = await chercher(chemin)
  verifier(`${libelle} répond 200`, r.statut === 200, r.statut)
  verifier(
    `${libelle} n'est pas servi comme du HTML`,
    !entete(r, 'content-type').includes('text/html'),
    entete(r, 'content-type'),
  )
  verifier(
    `${libelle} a le bon type`,
    entete(r, 'content-type').includes(type),
    entete(r, 'content-type'),
  )
}

// The social card image that is announced has to exist and be an image.
const annoncee = /property="og:image"\s+content="([^"]*)"/.exec(racine.corps)?.[1] ?? ''
verifier('une image de carte sociale est annoncée', annoncee.length > 0)
if (annoncee.startsWith(ORIGINE)) {
  const img = await chercher(annoncee.slice(ORIGINE.length))
  verifier(
    "l'image de carte sociale existe vraiment",
    img.statut === 200 && entete(img, 'content-type').startsWith('image/'),
    `${img.statut} ${entete(img, 'content-type')}`,
  )
}

const plan = await chercher('/sitemap.xml')
for (const [, adresse] of plan.corps.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const page = await chercher(adresse.replace(ORIGINE, ''))
  const canonique = /rel="canonical"\s+href="([^"]*)"/.exec(page.corps)?.[1] ?? ''
  verifier(
    `le sitemap et la canonique de ${adresse} disent la même chose`,
    canonique === adresse,
    `sitemap ${adresse}, canonique ${canonique}`,
  )
}

// --------------------------------------------------------------------- routing
const profond = await chercher('/t/abc123def456')
verifier('un lien profond rend l’application', profond.statut === 200, profond.statut)
verifier(
  'un lien profond rend du HTML',
  entete(profond, 'content-type').includes('text/html'),
  entete(profond, 'content-type'),
)
verifier(
  'un lien profond sert le même paquet que la racine',
  scriptDe(profond.corps) === scriptDe(racine.corps),
)

const espace = await chercher('/workspace')
verifier('la page espace de travail répond 200', espace.statut === 200, espace.statut)
verifier(
  "l'espace de travail sert le même paquet que la racine",
  scriptDe(espace.corps) === scriptDe(racine.corps),
)

const inexistant = await chercher('/ceci-nexiste-pas-du-tout.png')
verifier(
  'un fichier inexistant ne se fait pas passer pour une image',
  !entete(inexistant, 'content-type').startsWith('image/'),
  entete(inexistant, 'content-type'),
)

// -------------------------------------------------------------------- caching
const script = scriptDe(racine.corps)
if (script) {
  const asset = await chercher(script)
  verifier('le script empreinté répond 200', asset.statut === 200, asset.statut)
  verifier(
    'le script empreinté est gardé un an et immuable',
    /max-age=31536000/.test(entete(asset, 'cache-control')) &&
      /immutable/.test(entete(asset, 'cache-control')),
    entete(asset, 'cache-control'),
  )
  verifier(
    'le script est servi comme du JavaScript',
    entete(asset, 'content-type').includes('javascript'),
    entete(asset, 'content-type'),
  )
}
verifier(
  "index.html n'est pas gardé en cache sans revalidation",
  /no-cache|max-age=0/.test(entete(racine, 'cache-control')),
  entete(racine, 'cache-control'),
)
const sw = await chercher('/sw.js')
verifier('le service worker répond 200', sw.statut === 200, sw.statut)
// `public/_headers` asks for `no-cache` on `/sw.js` and Cloudflare serves
// `max-age=14400`: it edge-caches the file by its extension
// (`cf-cache-status: REVALIDATED`, against `DYNAMIC` for `index.html`, which the
// same rule does reach). Fixing it needs a right on the zone that the
// deployment token does not have; registration therefore passes
// `updateViaCache: 'none'` and the browser ignores its HTTP cache for this script.
constater(
  "l'hébergeur garde le service worker en cache",
  entete(sw, 'cache-control'),
  'no-cache est demandé dans _headers et non appliqué ; contourné côté code',
)
if (script) {
  const paquet = await chercher(script)
  verifier(
    'le service worker est enregistré en ignorant le cache HTTP',
    /updateViaCache\s*:\s*["']none["']/.test(paquet.corps),
    'updateViaCache absent du paquet servi',
  )
}
verifier('le service worker précharge des fichiers empreintés', /\/assets\/[^"']+/.test(sw.corps))
verifier(
  "le nom de cache du service worker n'est pas le nom de développement",
  !/keydler-dev/.test(sw.corps),
)

// ------------------------------------------------------------------- redirects
const clair = await fetch(`http://keydler.com/`, { redirect: 'manual' })
verifier('le trafic en clair est redirigé', clair.status >= 300 && clair.status < 400, clair.status)
verifier(
  'le trafic en clair est redirigé vers https',
  (clair.headers.get('location') ?? '').startsWith('https://'),
  clair.headers.get('location'),
)

for (const [chemin, attendu] of [
  ['/', 'https://keydler.com/'],
  ['/t/abc?x=1', 'https://keydler.com/t/abc?x=1'],
]) {
  const r = await fetch(`https://www.keydler.com${chemin}`, { redirect: 'manual' })
  verifier(`www${chemin} redirige vers l'apex`, r.status >= 300 && r.status < 400, r.status)
  verifier(
    `www${chemin} garde le chemin et la requête`,
    r.headers.get('location') === attendu,
    r.headers.get('location'),
  )
}

// ------------------------------------------------------------------ the weight
const octets = new TextEncoder().encode(racine.corps).length
verifier("le HTML d'entrée reste sous 8 ko", octets < 8192, `${octets} octets`)
if (script) {
  // `content-length` disappears on a stream-compressed response: it is
  // `content-encoding` that tells the truth. A first version of this check
  // measured the length and declared a failure where nothing was wrong.
  const compresse = await fetch(`${ORIGINE}${script}`, {
    headers: { 'accept-encoding': 'gzip, br' },
  })
  const codage = compresse.headers.get('content-encoding') ?? ''
  verifier('le script est servi compressé', /br|gzip|zstd/.test(codage), codage || '(aucun)')
}

// -------------------------------------------------------------------- functions
function scriptDe(html) {
  return /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? ''
}

async function empreinteDuScriptEnLigne(html) {
  const { createHash } = await import('node:crypto')
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return 'AUCUN-SCRIPT-EN-LIGNE'
  return `sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}`
}

// ---------------------------------------------------------------- the verdict
const total = reussites.length + echecs.length
if (!seulementEchecs) for (const n of reussites) console.log(`  ok    ${n}`)
for (const c of constats) console.log(`  note  ${c.nom} : ${c.valeur}\n          ${c.remarque}`)
for (const e of echecs) console.error(`  ÉCHEC ${e.nom}\n          observé : ${e.observe}`)

console.log(`\n${reussites.length}/${total} contrôles passés contre ${ORIGINE}`)
if (echecs.length > 0) {
  console.error(`${echecs.length} échec(s).`)
  process.exit(1)
}
