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
const BACKGROUND = '#0d120a'
const PANEL_START = '#285315'
const PANEL_END = '#9dcc55'
const TEXT = '#ffffff'
const MUTED = '#d8e3d1'
const ACCENT = '#d7f1a4'
const HIGHLIGHT = '#f4d76f'
const ON_HIGHLIGHT = '#355016'

const font = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

export const buildSvg =
  () => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${PANEL_START}"/>
      <stop offset="1" stop-color="${PANEL_END}"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#071204" stop-opacity="0.62"/>
      <stop offset="0.68" stop-color="#071204" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#071204" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${BACKGROUND}"/>
  <rect x="62" y="54" width="1076" height="522" rx="34" fill="url(#brand)"/>
  <rect x="62" y="54" width="1076" height="522" rx="34" fill="url(#shade)"/>

  <text x="112" y="116" font-family="${font}" font-size="22" font-weight="700"
        letter-spacing="4" fill="${ACCENT}">KEYDLER · WEBMCP TASK MEMORY</text>

  <text x="112" y="224" font-family="${font}" font-size="62" font-weight="720" fill="${TEXT}">
    Give every agent the context
  </text>
  <text x="112" y="296" font-family="${font}" font-size="62" font-weight="720" fill="${TEXT}">
    it must
  </text>
  <rect x="326" y="241" width="150" height="70" rx="8" fill="${HIGHLIGHT}"/>
  <text x="346" y="296" font-family="${font}" font-size="62" font-weight="760" fill="${ON_HIGHLIGHT}">NOT</text>
  <text x="495" y="296" font-family="${font}" font-size="62" font-weight="720" fill="${TEXT}">lose.</text>

  <text x="112" y="372" font-family="${font}" font-size="26" fill="${MUTED}">
    Completed work, binding rules, evidence, and dead ends,
  </text>
  <text x="112" y="410" font-family="${font}" font-size="26" fill="${MUTED}">
    read and updated by your agent through WebMCP.
  </text>

  <text x="112" y="518" font-family="${font}" font-size="24" fill="${MUTED}">
    keydler.com
  </text>
  <text x="1084" y="518" text-anchor="end" font-family="${font}" font-size="24" font-weight="650" fill="${ACCENT}">
    4 read tools + 9 write tools = 13
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
