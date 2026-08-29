import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// The image announced by `og:image` did not exist: the SPA fallback served the
// home page instead, so every shared card was broken. Seen in production, 200
// with `content-type: text/html`. 1200×630, the 1.91:1 platforms crop least.
// SVG rendered by a system tool rather than another dependency, with the PNG
// committed so the build does not need that tool. Resolved on use, not at load:
// imported from a test this module has no file URL.
const root = () => fileURLToPath(new URL('../', import.meta.url))

export const svgFingerprint = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// Dark palette from `src/tokens.css`, copied on purpose: the image is produced
// outside the CSS pipeline, and a value that changes over there has to be
// carried here knowingly.
const BACKGROUND = '#131316'
const SURFACE = '#1c1c20'
const BORDER = '#34343a'
const TEXT = '#e6e6ea'
const MUTED = '#a0a0ac'
const ACCENT = '#a3adf5'

const font = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

export const buildSvg =
  () => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BACKGROUND}"/>
  <rect x="72" y="150" width="1056" height="330" rx="18" fill="${SURFACE}" stroke="${BORDER}" stroke-width="2"/>

  <text x="120" y="112" font-family="${font}" font-size="26" font-weight="700"
        letter-spacing="4" fill="${ACCENT}">KEYDLER</text>

  <text x="120" y="268" font-family="${font}" font-size="58" font-weight="700" fill="${TEXT}">
    A shared memory for you
  </text>
  <text x="120" y="336" font-family="${font}" font-size="58" font-weight="700" fill="${TEXT}">
    and your AI.
  </text>

  <text x="120" y="400" font-family="${font}" font-size="27" fill="${MUTED}">
    Completed work, rules to follow, and mistakes not to repeat,
  </text>
  <text x="120" y="438" font-family="${font}" font-size="27" fill="${MUTED}">
    read and written by your agent over WebMCP, supervised by you.
  </text>

  <text x="120" y="568" font-family="${font}" font-size="24" fill="${MUTED}">
    keydler.com
  </text>
  <text x="1080" y="568" text-anchor="end" font-family="${font}" font-size="24" fill="${MUTED}">
    No account. No server.
  </text>
</svg>
`

// Rendered only when the script is run directly. A committed generated file
// goes stale in silence: this card kept an em dash for three hours after the
// text lost it, nothing comparing image to source. The SVG fingerprint now
// travels inside the PNG, and a test reads it back.
const runDirectly =
  import.meta.url.startsWith('file:') &&
  typeof process !== 'undefined' &&
  process.argv?.[1] === fileURLToPath(import.meta.url)

if (runDirectly) {
  const svg = buildSvg()
  const path = join(root(), 'public', 'og.png')
  await writeFile('/tmp/og.svg', svg, 'utf8')

  try {
    execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', path, '/tmp/og.svg'])
  } catch {
    execFileSync('magick', ['-background', 'none', '/tmp/og.svg', '-resize', '1200x630', path])
  }

  execFileSync('magick', [path, '-set', 'comment', `svg-sha256=${svgFingerprint(svg)}`, path])

  const { statSync } = await import('node:fs')
  const bytes = statSync(path).size
  console.log(`social card : public/og.png, ${(bytes / 1024).toFixed(1)} kB`)
  if (bytes > 1_000_000) {
    console.error('social card : over 1 MB, some platforms would refuse to load it.')
    process.exit(1)
  }
}
