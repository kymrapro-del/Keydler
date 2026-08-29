import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readToken } from './token.mjs'

// `dist/` can look complete and not be deployable: two substitutions happen
// after `vite build`. Without them the CSP carries `'__CSP_SCRIPT_HASH__'`, not
// a valid source, and the theme bootstrap script is blocked; the service worker
// precaches nothing under the fixed cache name `keydler-dev`, which never
// invalidates. Neither shows in the folder.
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

const problems = []
const reportProblem = (problem, reason) => problems.push(`${problem}\n    ${reason}`)

const read = async (path) => {
  try {
    return await readFile(join(dist, path), 'utf8')
  } catch {
    reportProblem(`dist/${path} is missing.`, 'The build did not finish.')
    return null
  }
}

const headers = await read('_headers')
const sw = await read('sw.js')
const html = await read('index.html')

if (headers?.includes('__CSP_SCRIPT_HASH__')) {
  reportProblem(
    'dist/_headers still contains __CSP_SCRIPT_HASH__.',
    'The served CSP would block the bootstrap script. `scripts/headers.mjs` did not run.',
  )
}

const builtAssets = (await readdir(join(dist, 'assets')).catch(() => [])).map((f) => `/assets/${f}`)

if (sw !== null) {
  // The template carries a SHELL list, but only of fixed names. A substituted
  // artifact is recognised by naming the fingerprinted files actually produced.
  // The template writes it as JavaScript, the substituted version as JSON, so
  // collect the paths without assuming which is being read.
  const shell = /const SHELL = (\[[^\]]*\])/.exec(sw)?.[1]
  const fingerprinted = [...(shell ?? '').matchAll(/['"](\/assets\/[^'"]+)['"]/g)].map((m) => m[1])

  if (shell === undefined) {
    reportProblem('dist/sw.js contains no SHELL list.', '`scripts/precache.mjs` did not run.')
  } else if (fingerprinted.length === 0) {
    reportProblem(
      'dist/sw.js precaches no file from dist/assets.',
      'Offline mode would load the page without its script or stylesheet.',
    )
  } else {
    const ghosts = fingerprinted.filter((p) => !builtAssets.includes(p))
    if (ghosts.length > 0) {
      reportProblem(
        `dist/sw.js precaches ${ghosts.length} missing file(s) : ${ghosts.join(', ')}`,
        'Precaching would fail and prevent service worker installation.',
      )
    }
  }

  const cache = /const CACHE = '([^']*)'/.exec(sw)?.[1] ?? ''
  if (cache === '' || cache.endsWith('-dev')) {
    reportProblem(
      `dist/sw.js keeps the cache name “${cache || '(empty)'}”.`,
      'A fixed name never invalidates, so visitors would retain the old version.',
    )
  }
}

// The fingerprint has to match the HTML actually built, and `vercel.json` holds
// it hard-coded: it is read from the repository at deploy time, not from dist.
if (html !== null && headers !== null) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  if (scripts.length !== 1) {
    reportProblem(
      `dist/index.html contains ${scripts.length} inline script(s), expected one.`,
      'Every inline script must be authorized by its hash.',
    )
  } else {
    const expected = `sha256-${createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')}`
    if (!headers.includes(expected)) {
      reportProblem(
        'dist/_headers does not contain the built inline script hash.',
        `Expected : ${expected}`,
      )
    }
    const vercel = await readFile(join(root, 'vercel.json'), 'utf8')
    if (!vercel.includes(expected)) {
      reportProblem(
        'vercel.json has drifted from the inline script hash.',
        `Copy ${expected} into vercel.json. A stale policy provides no protection.`,
      )
    }
  }
}

// Without an origin trial token valid for the origin served,
// `document.modelContext` does not exist and the page reads "WebMCP is not
// available in this browser", everything else being correct.
// `ALLOW_NO_ORIGIN_TRIAL=1` lifts the requirement, which is what `npm run
// check` uses: it builds to verify, not to publish.
const SERVED_ORIGINS = ['https://keydler.com', 'https://keydler.pages.dev']
const FEATURE = 'WebMCP'

if (html !== null && process.env.ALLOW_NO_ORIGIN_TRIAL !== '1') {
  const tags = [...html.matchAll(/<meta\s+http-equiv="origin-trial"\s+content="([^"]*)"/g)].map(
    (m) =>
      m[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&'),
  )

  if (tags.length === 0) {
    reportProblem(
      'dist/index.html contains no origin-trial tag.',
      'WebMCP would require chrome://flags with no visible explanation.',
    )
  }

  const covered = new Set()
  for (const raw of tags) {
    const token = readToken(raw)
    if (token.error) {
      reportProblem(
        `An origin trial token is unreadable : ${token.error}.`,
        'Copy it exactly as issued.',
      )
      continue
    }
    if (token.feature !== FEATURE) {
      reportProblem(
        `A token enables “${token.feature}”, not “${FEATURE}”.`,
        'It will not enable WebMCP.',
      )
      continue
    }
    if (token.thirdParty) {
      reportProblem(
        `The token for ${token.origin} is a third-party token.`,
        'Third-party tokens work only when injected by a third-party script.',
      )
      continue
    }
    // The token origin includes the port (`https://keydler.com:443`) while the
    // origin served does not write it. Compared on the origin prefix.
    const origin = String(token.origin ?? '').replace(/:443$/, '')
    if (!SERVED_ORIGINS.includes(origin)) {
      reportProblem(
        `A token was issued for “${token.origin}”, which is not served.`,
        `Expected one of : ${SERVED_ORIGINS.join(', ')}. A mismatch fails silently.`,
      )
      continue
    }
    if (token.expires === null) {
      reportProblem(
        `The token for ${origin} has no readable expiration date.`,
        'Its payload is malformed.',
      )
      continue
    }
    if (token.expires.getTime() <= Date.now()) {
      reportProblem(
        `The token for ${origin} expired on ${token.expires.toISOString().slice(0, 10)}.`,
        'Chrome validates it offline, so deployment cannot repair an expired token.',
      )
      continue
    }
    covered.add(origin)
  }

  const canonical = SERVED_ORIGINS[0]
  if (tags.length > 0 && !covered.has(canonical)) {
    reportProblem(
      `No valid token covers the canonical origin ${canonical}.`,
      'This is the origin judges will see.',
    )
  }
}

const sourceMaps = builtAssets.filter((f) => f.endsWith('.map'))
if (sourceMaps.length > 0) {
  reportProblem(
    `dist/assets contains ${sourceMaps.length} source map(s).`,
    'Source maps publish source code. Build without SOURCEMAP=1.',
  )
}

if (problems.length > 0) {
  console.error(`artifact : ${problems.length} reason(s) not to deploy this directory.\n`)
  for (const problem of problems) console.error(`  - ${problem}\n`)
  console.error('Rebuild with `npm run build` or `build:trial`, not `vite build` alone.')
  process.exit(1)
}

console.log('artifact : dist/ is deployable.')
