#!/usr/bin/env node
/**
 * Convertit la vidéo de fond de la section « Under the hood » (l'organigramme
 * de nœuds en verre qui se connectent) en deux WebM prêts à être pilotés par
 * le scroll — un par thème.
 *
 * Source : assets-src/brand/tool-anatomy.mp4 — export brut du générateur
 * vidéo, sur fond NOIR (pas toujours pur : certains générateurs y laissent un
 * grain fin, voir `hqdn3d` plus bas), avec une piste audio inutile.
 *
 * Pourquoi deux fichiers plutôt qu'un canal alpha : une vidéo WebM/VP9 avec
 * alpha réel a été tentée d'abord (colorkey + `-pix_fmt yuva420p`), mais
 * l'aller-retour encode→décode s'est avéré cassé sur cette machine — libvpx
 * annonce `yuva420p` à l'encodage, et ffmpeg lui-même relit un flux `yuv420p`
 * strictement opaque (constaté en sondant les pixels du coin, VP8 comme VP9,
 * avec et sans `-auto-alt-ref 0`). Safari, en plus, ne décode aucune vidéo
 * avec alpha nativement — même un ffmpeg qui aurait fonctionné n'aurait
 * couvert qu'une partie des navigateurs. Détourer le fond puis l'aplatir
 * directement sur la VRAIE couleur de fond de `#tool-anatomy`
 * (`--md-sys-color-surface-container-low`) donne une vidéo opaque banale,
 * lisible partout, sans dépendre d'aucun support d'alpha vidéo.
 *
 * Cette couleur change avec le thème (crème en clair, quasi noir en sombre)
 * — un seul aplat baké ne collerait qu'à un des deux. D'où les deux sorties,
 * lues directement dans src/tokens.css plutôt que recopiées à la main : si le
 * seed de marque change et régénère tokens.css, ce script suit sans qu'on
 * ait à le retoucher.
 *
 * Sorties : public/assets/brand/tool-anatomy-light.webm et
 * tool-anatomy-dark.webm — VP9, sans piste audio, redimensionnés à
 * TARGET_WIDTH. `src/ui/bench.ts` bascule entre les deux au changement de
 * thème, même principe que `applyColor()` dans silkBackground.ts.
 *
 * Rejouable : `node scripts/process-brand-video.mjs`, même contrat que
 * process-brand-assets.mjs. Nécessite ffmpeg dans le PATH — contrairement au
 * pipeline PNG (sharp, une dépendance npm), aucune bibliothèque JS ne fait ce
 * travail correctement ; le script échoue clairement si ffmpeg est absent
 * plutôt que de produire un fichier muet.
 */

/* global console, process */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'assets-src', 'brand', 'tool-anatomy.mp4')
const TOKENS_PATH = path.join(__dirname, '..', 'src', 'tokens.css')
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'brand')

// Largeur d'affichage cible. La source (1280px) dépasse largement ce qu'il
// faut pour un élément décoratif dans une carte — la redimensionner ici
// évite de servir 1280px de vidéo pour un rendu à 500-600px de large.
const TARGET_WIDTH = 960

if (!existsSync(SRC)) {
  console.error(`Source introuvable : ${SRC}`)
  console.error('Dépose l’export vidéo brut sous ce nom avant de relancer ce script.')
  process.exit(1)
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('ffmpeg est introuvable dans le PATH.')
  console.error('Installe-le (ex. `winget install ffmpeg`) puis relance ce script.')
  process.exit(1)
}

// Les deux valeurs de `--md-sys-color-surface-container-low` apparaissent
// plusieurs fois dans tokens.css (`:root`, la media query sombre, les
// attributs `data-theme` explicites) mais ne portent jamais que deux
// couleurs distinctes : la première rencontrée est la valeur claire (celle du
// `:root` par défaut), la première différente qui suit est la sombre.
const tokens = readFileSync(TOKENS_PATH, 'utf8')
const matches = [
  ...tokens.matchAll(/--md-sys-color-surface-container-low:\s*(#[0-9a-f]{6});/gi),
].map((m) => m[1])
const light = matches[0]
const dark = matches.find((hex) => hex !== light)
if (!light || !dark) {
  console.error(
    `Impossible de trouver deux valeurs distinctes pour --md-sys-color-surface-container-low dans ${TOKENS_PATH}.`,
  )
  process.exit(1)
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const probe = execFileSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=width,height',
  '-of',
  'csv=p=0:s=x',
  SRC,
])
  .toString()
  .trim()
const [srcWidth, srcHeight] = probe.split('x').map(Number)
const targetWidth = Math.min(TARGET_WIDTH, srcWidth)
const targetHeight = Math.round((targetWidth * srcHeight) / srcWidth / 2) * 2 // pair, requis par yuv420p

for (const [label, hex] of [
  ['light', light],
  ['dark', dark],
]) {
  const out = path.join(OUT_DIR, `tool-anatomy-${label}.webm`)
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${hex}:s=${targetWidth}x${targetHeight}`,
      '-i',
      SRC,
      '-filter_complex',
      // Le fond « noir » de certains générateurs n'est pas un aplat pur : il
      // porte un grain fin (mesuré ~(26,25,28), à peine distinct des zones
      // d'ombre les plus sombres de l'objet, ~(23,23,23)) — un `colorkey` nu
      // laissait des plaques grisâtres mal détourées. `hqdn3d` lisse ce grain
      // avant la clé, sans affecter les zones à fort contraste (facettes,
      // lignes lumineuses) qui portent l'essentiel du rendu.
      `[1:v]scale=${targetWidth}:${targetHeight}:flags=lanczos,hqdn3d=6:6:8:8,colorkey=black:0.16:0.12[fg];` +
        `[0:v][fg]overlay=shortest=1,format=yuv420p[out]`,
      '-map',
      '[out]',
      '-an', // pas de piste audio : jamais jouée, jamais entendue
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      '0',
      '-crf',
      '34',
      '-deadline',
      'good',
      '-cpu-used',
      '2',
      out,
    ],
    { stdio: 'inherit' },
  )
  console.log(`\n${out} généré (fond ${hex}).`)
}
