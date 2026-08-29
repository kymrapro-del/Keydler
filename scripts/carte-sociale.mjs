import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// The image announced by `og:image` did not exist: the SPA fallback served the
// home page in its place and every shared card was broken (checked in
// production, 200 with `content-type: text/html`). 1200×630, the 1.91:1 that
// platforms crop the least. SVG rendered by a system tool rather than one more
// dependency; the PNG committed to the repo, so that the build does not
// require that tool.
const racine = fileURLToPath(new URL('../', import.meta.url))

// Dark palette from `src/tokens.css`, copied on purpose: the image is produced
// outside the CSS pipeline, and a value that changes over there has to be
// carried here knowingly.
const FOND = '#131316'
const SURFACE = '#1c1c20'
const BORDURE = '#34343a'
const TEXT = '#e6e6ea'
const ATTENUE = '#a0a0ac'
const ACCENT = '#a3adf5'

const police = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${FOND}"/>
  <rect x="72" y="150" width="1056" height="330" rx="18" fill="${SURFACE}" stroke="${BORDURE}" stroke-width="2"/>

  <text x="120" y="112" font-family="${police}" font-size="26" font-weight="700"
        letter-spacing="4" fill="${ACCENT}">KEYDLER</text>

  <text x="120" y="268" font-family="${police}" font-size="58" font-weight="700" fill="${TEXT}">
    A shared memory for you
  </text>
  <text x="120" y="336" font-family="${police}" font-size="58" font-weight="700" fill="${TEXT}">
    and your AI.
  </text>

  <text x="120" y="400" font-family="${police}" font-size="27" fill="${ATTENUE}">
    Completed work, rules to follow, and mistakes not to repeat,
  </text>
  <text x="120" y="438" font-family="${police}" font-size="27" fill="${ATTENUE}">
    read and written by your agent over WebMCP, supervised by you.
  </text>

  <text x="120" y="568" font-family="${police}" font-size="24" fill="${ATTENUE}">
    keydler.com
  </text>
  <text x="1080" y="568" text-anchor="end" font-family="${police}" font-size="24" fill="${ATTENUE}">
    No account. No server.
  </text>
</svg>
`

const path = join(racine, 'public', 'og.png')
await writeFile('/tmp/og.svg', svg, 'utf8')

try {
  execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', path, '/tmp/og.svg'])
} catch {
  execFileSync('magick', ['-background', 'none', '/tmp/og.svg', '-resize', '1200x630', path])
}

const { statSync } = await import('node:fs')
const octets = statSync(path).size
console.log(`carte sociale: public/og.png, ${(octets / 1024).toFixed(1)} ko`)
if (octets > 1_000_000) {
  console.error('carte sociale: plus de 1 Mo, certaines plateformes refuseraient de la charger.')
  process.exit(1)
}
