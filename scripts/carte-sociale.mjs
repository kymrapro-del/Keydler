import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// L'image annoncée par `og:image` n'existait pas : le repli SPA rendait la page
// d'accueil à sa place et toute carte partagée était cassée (vérifié en
// production, 200 avec `content-type: text/html`). 1200×630, soit le 1,91:1 que
// les plateformes recadrent le moins. Du SVG rendu par un outil du système
// plutôt qu'une dépendance de plus ; le PNG versionné, pour que la construction
// n'exige pas cet outil.
const racine = fileURLToPath(new URL('../', import.meta.url))

// Palette sombre de `src/tokens.css`, recopiée à dessein : l'image est
// produite hors de la chaîne CSS, et une valeur qui change là-bas doit se
// reporter ici sciemment.
const FOND = '#131316'
const SURFACE = '#1c1c20'
const BORDURE = '#34343a'
const TEXTE = '#e6e6ea'
const ATTENUE = '#a0a0ac'
const ACCENT = '#a3adf5'

const police = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${FOND}"/>
  <rect x="72" y="150" width="1056" height="330" rx="18" fill="${SURFACE}" stroke="${BORDURE}" stroke-width="2"/>

  <text x="120" y="112" font-family="${police}" font-size="26" font-weight="700"
        letter-spacing="4" fill="${ACCENT}">KEYDLER</text>

  <text x="120" y="268" font-family="${police}" font-size="58" font-weight="700" fill="${TEXTE}">
    A shared memory for you
  </text>
  <text x="120" y="336" font-family="${police}" font-size="58" font-weight="700" fill="${TEXTE}">
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

const chemin = join(racine, 'public', 'og.png')
await writeFile('/tmp/og.svg', svg, 'utf8')

try {
  execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', chemin, '/tmp/og.svg'])
} catch {
  execFileSync('magick', ['-background', 'none', '/tmp/og.svg', '-resize', '1200x630', chemin])
}

const { statSync } = await import('node:fs')
const octets = statSync(chemin).size
console.log(`carte sociale: public/og.png, ${(octets / 1024).toFixed(1)} ko`)
if (octets > 1_000_000) {
  console.error('carte sociale: plus de 1 Mo, certaines plateformes refuseraient de la charger.')
  process.exit(1)
}
