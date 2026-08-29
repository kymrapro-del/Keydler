// Checks against the live site. The suite runs in jsdom over source code, and
// this project has paid for that four times: green tests while a browser found
// the defect in a minute. Covered here: host headers, redirects, MIME types,
// caching, SPA fallback. Exits non zero, so it can gate a deploy.
const ORIGIN = process.argv[2] ?? 'https://keydler.com'
const failuresOnly = process.argv.includes('--failures')

const successes = []
const failures = []

const observations = []

function check(name, condition, observed) {
  if (condition) successes.push(name)
  else failures.push({ name, observed })
}

/**
 * Observed but not fixable here. Shown on every run, and never fails the gate,
 * or the gate becomes noise.
 */
function recordObservation(name, value, note) {
  observations.push({ name, value, note })
}

const cache = new Map()
async function fetchPath(path, options = {}) {
  const key = `${options.method ?? 'GET'} ${path}${options.redirect ?? ''}`
  if (cache.has(key)) return cache.get(key)
  const r = await fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...options })
  const body = options.method === 'HEAD' ? '' : await r.text()
  const result = { status: r.status, headers: r.headers, body }
  cache.set(key, result)
  return result
}

const header = (r, name) => r.headers.get(name) ?? ''
const directive = (csp, name) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `)) ?? ''

// ----------------------------------------------------------------- the root
const root = await fetchPath('/')

check('the root responds with 200', root.status === 200, root.status)
check(
  'the root is HTML',
  header(root, 'content-type').includes('text/html'),
  header(root, 'content-type'),
)
check('the root declares a character set', /charset=utf-8/i.test(header(root, 'content-type')))

// ----------------------------------------------------------- security headers
const csp = header(root, 'content-security-policy')
check('a content security policy is served', csp.length > 0)
check("default-src starts from 'none'", directive(csp, 'default-src') === "default-src 'none'", csp)
check(
  'frame-ancestors forbids framing',
  directive(csp, 'frame-ancestors') === "frame-ancestors 'none'",
)
check('form-action forbids submission', directive(csp, 'form-action') === "form-action 'none'")
check('base-uri is locked down', directive(csp, 'base-uri') === "base-uri 'none'")
check('object-src is locked down', directive(csp, 'object-src') === "object-src 'none'")
check('the policy does not allow unsafe-inline', !csp.includes('unsafe-inline'))
check('the policy does not allow unsafe-eval', !csp.includes('unsafe-eval'))
check('the policy contains no wildcard', !csp.includes('*'))
check(
  'the inline script is allowed by exactly one hash',
  (csp.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []).length === 1,
  csp.match(/'sha256-[A-Za-z0-9+/=]+'/g),
)
check(
  'the policy hash matches the script that is actually served',
  csp.includes(await inlineScriptHash(root.body)),
)

const expectedHeaders = [
  ['strict-transport-security', /max-age=31536000/, 'HSTS lasts one year'],
  ['strict-transport-security', /includeSubDomains/, 'HSTS covers subdomains'],
  ['x-content-type-options', /^nosniff$/, 'type sniffing is refused'],
  ['x-frame-options', /^DENY$/, 'framing is refused'],
  ['referrer-policy', /^no-referrer$/, 'the origin address does not leak'],
  ['cross-origin-opener-policy', /^same-origin$/, 'the window is isolated'],
  ['cross-origin-resource-policy', /^same-origin$/, 'the resource is isolated'],
]
for (const [name, pattern, label] of expectedHeaders) {
  check(label, pattern.test(header(root, name).trim()), header(root, name))
}

const permissions = header(root, 'permissions-policy')
for (const capability of [
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
  check(`the ${capability} capability is refused`, permissions.includes(`${capability}=()`))
}

check(
  'no header identifies server software beyond the hosting provider',
  !root.body.includes('X-Powered-By') && header(root, 'x-powered-by') === '',
)

// ----------------------------------------------------------------- the token
const tokens = [...root.body.matchAll(/http-equiv="origin-trial"\s+content="([^"]*)"/g)]
check('an origin trial token is served', tokens.length >= 1, tokens.length)
if (tokens.length >= 1) {
  const { readToken } = await import('./token.mjs')
  const j = readToken(tokens[0][1])
  check('the token is readable', !j.error, j.error)
  check('the token carries the WebMCP feature', j.feature === 'WebMCP', j.feature)
  check(
    'the token is issued for the served origin',
    String(j.origin ?? '').replace(/:443$/, '') === ORIGIN,
    j.origin,
  )
  check(
    'the token has not expired',
    j.expires !== null && j.expires.getTime() > Date.now(),
    j.expires,
  )
  check(
    'the token remains valid through the end of contest judging',
    j.expires !== null && j.expires.getTime() > Date.parse('2026-09-21T23:59:59Z'),
    j.expires,
  )
  check('the token is not a third-party token, which would not activate in a page', !j.thirdParty)
}

// ------------------------------------------------------------------ the markup
check('the page declares its language', /<html[^>]+lang="/.test(root.body))
check('the page has a title', /<title>[^<]{10,70}<\/title>/.test(root.body))
check(
  'the page has exactly one description tag',
  (root.body.match(/name="description"/g) ?? []).length === 1,
  (root.body.match(/name="description"/g) ?? []).length,
)
check('the page declares a canonical address', /rel="canonical"/.test(root.body))
check(
  'the canonical address is the HTTPS apex',
  /rel="canonical"\s+href="https:\/\/keydler\.com\//.test(root.body),
)
for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:site_name']) {
  check(`the social card includes ${tag}`, root.body.includes(`property="${tag}"`))
}
check('a Twitter card is declared', root.body.includes('name="twitter:card"'))
check('a manifest is declared', root.body.includes('rel="manifest"'))
check('an icon is declared', root.body.includes('rel="icon"'))
check('a theme color is declared', root.body.includes('name="theme-color"'))
check('the page adapts to mobile screens', root.body.includes('name="viewport"'))

// -------------------------------------------------------------- discovery
// files
for (const [path, type, label] of [
  ['/robots.txt', 'text/plain', 'robots.txt'],
  ['/sitemap.xml', 'xml', 'sitemap.xml'],
  // Browsers and aggregators ask for it at the root without reading the HTML.
  // The SPA fallback handed them the home page as text/html.
  ['/favicon.ico', 'image/', 'favicon.ico'],
  ['/manifest.webmanifest', 'json', 'the manifest'],
  ['/icons/icon.svg', 'svg', 'the icon'],
]) {
  const r = await fetchPath(path)
  check(`${label} responds with 200`, r.status === 200, r.status)
  check(
    `${label} is not served as HTML`,
    !header(r, 'content-type').includes('text/html'),
    header(r, 'content-type'),
  )
  check(
    `${label} has the correct type`,
    header(r, 'content-type').includes(type),
    header(r, 'content-type'),
  )
}

// The social card image that is announced has to exist and be an image.
const announced = /property="og:image"\s+content="([^"]*)"/.exec(root.body)?.[1] ?? ''
check('a social card image is announced', announced.length > 0)
if (announced.startsWith(ORIGIN)) {
  const img = await fetchPath(announced.slice(ORIGIN.length))
  check(
    'the social card image actually exists',
    img.status === 200 && header(img, 'content-type').startsWith('image/'),
    `${img.status} ${header(img, 'content-type')}`,
  )
}

const plan = await fetchPath('/sitemap.xml')
for (const [, address] of plan.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const page = await fetchPath(address.replace(ORIGIN, ''))
  const canonical = /rel="canonical"\s+href="([^"]*)"/.exec(page.body)?.[1] ?? ''
  check(
    `the sitemap and canonical address for ${address} agree`,
    canonical === address,
    `sitemap ${address}, canonical ${canonical}`,
  )
}

// --------------------------------------------------------------------- routing
const deepLink = await fetchPath('/t/abc123def456')
check('a deep link renders the application', deepLink.status === 200, deepLink.status)
check(
  'a deep link renders HTML',
  header(deepLink, 'content-type').includes('text/html'),
  header(deepLink, 'content-type'),
)
check(
  'a deep link serves the same bundle as the root',
  scriptFrom(deepLink.body) === scriptFrom(root.body),
)

const workspace = await fetchPath('/workspace')
check('the workspace page responds with 200', workspace.status === 200, workspace.status)
check(
  'the workspace serves the same bundle as the root',
  scriptFrom(workspace.body) === scriptFrom(root.body),
)

const missing = await fetchPath('/this-file-does-not-exist.png')
check(
  'a missing file does not masquerade as an image',
  !header(missing, 'content-type').startsWith('image/'),
  header(missing, 'content-type'),
)

// -------------------------------------------------------------------- caching
const script = scriptFrom(root.body)
if (script) {
  const asset = await fetchPath(script)
  check('the hashed script responds with 200', asset.status === 200, asset.status)
  check(
    'the hashed script is cached immutably for one year',
    /max-age=31536000/.test(header(asset, 'cache-control')) &&
      /immutable/.test(header(asset, 'cache-control')),
    header(asset, 'cache-control'),
  )
  check(
    'the script is served as JavaScript',
    header(asset, 'content-type').includes('javascript'),
    header(asset, 'content-type'),
  )
}
check(
  'index.html is not cached without revalidation',
  /no-cache|max-age=0/.test(header(root, 'cache-control')),
  header(root, 'cache-control'),
)
const sw = await fetchPath('/sw.js')
check('the service worker responds with 200', sw.status === 200, sw.status)
// `public/_headers` asks for `no-cache` on `/sw.js` and Cloudflare serves
// `max-age=14400`: it edge-caches the file by its extension (`cf-cache-status:
// REVALIDATED`, against `DYNAMIC` for `index.html`, which the same rule does
// reach). Fixing it needs a right on the zone that the deployment token does
// not have; registration therefore passes `updateViaCache: 'none'` and the
// browser ignores its HTTP cache for this script.
recordObservation(
  'the hosting provider caches the service worker',
  header(sw, 'cache-control'),
  'no-cache is requested in _headers but not applied; bypassed in code',
)
if (script) {
  const bundle = await fetchPath(script)
  check(
    'the service worker is registered while bypassing the HTTP cache',
    /updateViaCache\s*:\s*["']none["']/.test(bundle.body),
    'updateViaCache is absent from the served bundle',
  )
}
check('the service worker precaches hashed files', /\/assets\/[^"']+/.test(sw.body))
check('the service worker cache name is not the development name', !/keydler-dev/.test(sw.body))

// ------------------------------------------------------------------- redirects
const plainHttp = await fetch(`http://keydler.com/`, { redirect: 'manual' })
check(
  'plain HTTP traffic is redirected',
  plainHttp.status >= 300 && plainHttp.status < 400,
  plainHttp.status,
)
check(
  'plain HTTP traffic is redirected to HTTPS',
  (plainHttp.headers.get('location') ?? '').startsWith('https://'),
  plainHttp.headers.get('location'),
)

for (const [path, expected] of [
  ['/', 'https://keydler.com/'],
  ['/t/abc?x=1', 'https://keydler.com/t/abc?x=1'],
]) {
  const r = await fetch(`https://www.keydler.com${path}`, { redirect: 'manual' })
  check(`www${path} redirects to the apex`, r.status >= 300 && r.status < 400, r.status)
  check(
    `www${path} preserves the path and query`,
    r.headers.get('location') === expected,
    r.headers.get('location'),
  )
}

// ------------------------------------------------------------------ the weight
const bytes = new TextEncoder().encode(root.body).length
check('entry HTML remains under 8 kB', bytes < 8192, `${bytes} bytes`)
if (script) {
  // `content-length` disappears on a stream-compressed response;
  // `content-encoding` is what tells. A first version measured the length and
  // failed where nothing was wrong.
  const compressed = await fetch(`${ORIGIN}${script}`, {
    headers: { 'accept-encoding': 'gzip, br' },
  })
  const encoding = compressed.headers.get('content-encoding') ?? ''
  check('the script is served compressed', /br|gzip|zstd/.test(encoding), encoding || '(none)')
}

// --------------------------------------------------------------------
// functions
function scriptFrom(html) {
  return /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? ''
}

async function inlineScriptHash(html) {
  const { createHash } = await import('node:crypto')
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return 'NO-INLINE-SCRIPT'
  return `sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}`
}

// ---------------------------------------------------------------- the verdict
const total = successes.length + failures.length
if (!failuresOnly) for (const n of successes) console.log(`  ok    ${n}`)
for (const c of observations) console.log(`  note  ${c.name} : ${c.value}\n          ${c.note}`)
for (const e of failures) console.error(`  FAIL  ${e.name}\n          observed : ${e.observed}`)

console.log(`\n${successes.length}/${total} checks passed against ${ORIGIN}`)
if (failures.length > 0) {
  console.error(`${failures.length} failure(s).`)
  process.exit(1)
}
