#!/usr/bin/env node
/**
 * Génère src/tokens.css à partir d'une seule couleur-source, via
 * @material/material-color-utilities (l'implémentation de référence de
 * Google pour l'algorithme de couleur Material Design 3).
 *
 * Rejouable : `node scripts/generate-tokens.mjs` réécrit tokens.css à
 * l'identique tant que les constantes ci-dessous ne changent pas. Aucune
 * valeur hexadécimale n'est écrite à la main dans le CSS — tout sort soit du
 * générateur M3, soit des tableaux de constantes de spec (typographie,
 * formes, élévation, mouvement) déclarés explicitement dans ce fichier.
 *
 * Avant d'écrire quoi que ce soit, le script vérifie le contraste WCAG de
 * chaque paire texte/fond (et bordure/fond) que l'interface compose depuis les
 * rôles M3. Si une seule paire échoue, le script s'arrête en erreur et
 * n'écrit pas tokens.css : mieux vaut un lot bloqué qu'un jeton inaccessible
 * livré silencieusement.
 */

/* global console, process */

import { register } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// -----------------------------------------------------------------------
// Contournement d'un bug de packaging de material-color-utilities@0.4.0 :
// dynamiccolor/color_spec_2025.js importe './dynamic_color' sans extension,
// ce que le résolveur ESM strict de Node refuse (Vite/esbuild s'en
// accommodent, pas `node` seul). Voir scripts/mcu-resolve-hook.mjs.
// -----------------------------------------------------------------------
register('./mcu-resolve-hook.mjs', import.meta.url)

const { Hct, SchemeTonalSpot, MaterialDynamicColors, customColor, argbFromHex, hexFromArgb } =
  await import('@material/material-color-utilities')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'tokens.css')

// -----------------------------------------------------------------------
// 1. Couleurs-sources
// -----------------------------------------------------------------------

const SOURCE = '#61942e' // vert de marque — ancre de la nouvelle direction artistique

// Groupes de couleurs custom M3 : signaux sémantiques qui doivent rester
// distinguables d'une action principale sans dépendre de la teinte
// primary. Voir la note en fin de fichier sur le rejet/erreur.
//
// `verified` ne peut plus être vert : la marque elle-même devient verte avec
// cette charte, et un fait confirmé par un humain qui parlerait la même
// langue que le décor de la page cesserait de se voir comme un signal. C'est
// exactement la collision qu'on refusait déjà quand la marque était ambre et
// qu'aucun signal custom n'utilisait l'ambre pour autre chose que la marque —
// seulement inversée : c'est maintenant le vert qu'il faut éviter d'employer
// deux fois. Répartition retenue, quatre teintes maximalement séparées :
//   - marque : vert (SOURCE)
//   - proposal : ambre — l'ancienne couleur de marque. L'ambre dit
//     « en attente » naturellement, ce qui est exactement le statut d'une
//     proposition d'agent non endossée.
//   - verified : bleu — la convention « vérifié » la plus reconnue.
//   - error : rouge (rôle M3 standard, inchangé).
// Rien ne se confond entre ces quatre-là, y compris en vision deutéranope.
const CUSTOM_SEEDS = {
  proposal: '#8a5100', // ambre — l'ancienne couleur de marque, lue comme « en attente »
  verified: '#1a6bc4', // bleu — la convention « vérifié » la plus reconnue
}

// blend: false — on ne veut PAS que ces teintes dérivent vers la couleur
// primary. Le blend M3 est une recommandation d'harmonie visuelle ; ici
// l'exigence produit est l'inverse : rester loin du primary en teinte pour
// qu'une proposition ou un fait vérifié ne se lisent jamais comme une action
// de marque. Voir docs/plan-developpement.md §2 et la mission ci-dessus.
const CUSTOM_BLEND = false

const CONTRAST_LEVEL = 0 // 0 = contraste standard de la spec, ni min ni max

// -----------------------------------------------------------------------
// Jetons de marque — PAS des rôles M3. Relevés tels quels dans la maquette
// Figma (fills bruts, aucune variable n'y est déclarée) : rien à faire dériver
// d'une source ni à vérifier algorithmiquement, contrairement aux rôles M3
// ci-dessous. Émis par ce script (et non tapés dans tokens.css) pour que le
// fichier entier reste régénérable à l'identique par un seul point d'entrée.
//
// Dégradé de marque : direction INVERSÉE par rapport à la maquette (+180° sur
// l'angle relevé, 157.57° → 337.57°). Dans la maquette, le texte blanc de la
// bannière tombe sur l'extrémité claire du dégradé (#B4D665 contre blanc :
// 1.65:1 ; l'ancre #61942E contre blanc : 3.63:1 — les deux sous le seuil AA
// pour du texte). L'extrémité sombre (#406B1A contre blanc : ~6.3:1) passe
// largement. On garde les quatre verts et leurs positions respectives — on ne
// change QUE le sens dans lequel le dégradé traverse la bannière, pour que le
// texte tombe sur la zone sombre plutôt que sur la zone claire.
const BRAND_GRADIENT_ANGLE = 157.57 + 180 // 337.57deg — sombre derrière le texte
const BRAND_GRADIENT_STOPS = [
  ['#b4d665', 0],
  ['#8ebe51', 24.749],
  ['#61942e', 45.962],
  ['#406b1a', 70.711],
]

// Surligneur de marque. Le texte posé dessus (#61942E, la couleur-source) ne
// suffit PAS seul au contraste AA sur grand texte (2.71:1, sous le seuil de
// 3:1) : c'est une valeur de marque prise telle quelle dans la maquette, pas
// un rôle M3 généré, donc ce script ne peut pas la corriger algorithmiquement
// comme il le fait pour les paires ci-dessous. Documenté ici pour que le
// choix ne se perde pas silencieusement ; à traiter côté maquette (Kymra).
const BRAND_HIGHLIGHT = '#ffdb78'
const BRAND_ON_HIGHLIGHT = '#61942e'

// -----------------------------------------------------------------------
// 2. Rôles de couleur M3 → méthodes de MaterialDynamicColors
// -----------------------------------------------------------------------

const COLOR_ROLES = [
  ['primary', 'primary'],
  ['on-primary', 'onPrimary'],
  ['primary-container', 'primaryContainer'],
  ['on-primary-container', 'onPrimaryContainer'],
  ['secondary', 'secondary'],
  ['on-secondary', 'onSecondary'],
  ['secondary-container', 'secondaryContainer'],
  ['on-secondary-container', 'onSecondaryContainer'],
  ['tertiary', 'tertiary'],
  ['on-tertiary', 'onTertiary'],
  ['tertiary-container', 'tertiaryContainer'],
  ['on-tertiary-container', 'onTertiaryContainer'],
  ['error', 'error'],
  ['on-error', 'onError'],
  ['error-container', 'errorContainer'],
  ['on-error-container', 'onErrorContainer'],
  ['surface', 'surface'],
  ['surface-dim', 'surfaceDim'],
  ['surface-bright', 'surfaceBright'],
  ['surface-container-lowest', 'surfaceContainerLowest'],
  ['surface-container-low', 'surfaceContainerLow'],
  ['surface-container', 'surfaceContainer'],
  ['surface-container-high', 'surfaceContainerHigh'],
  ['surface-container-highest', 'surfaceContainerHighest'],
  ['on-surface', 'onSurface'],
  ['on-surface-variant', 'onSurfaceVariant'],
  ['outline', 'outline'],
  ['outline-variant', 'outlineVariant'],
  ['inverse-surface', 'inverseSurface'],
  ['inverse-on-surface', 'inverseOnSurface'],
  ['inverse-primary', 'inversePrimary'],
  ['shadow', 'shadow'],
  ['scrim', 'scrim'],
]

// -----------------------------------------------------------------------
// 3. Génération des schémas clair/sombre + couleurs custom
// -----------------------------------------------------------------------

const sourceArgb = argbFromHex(SOURCE)
const sourceHct = Hct.fromInt(sourceArgb)
const mdc = new MaterialDynamicColors()

const schemeDark = new SchemeTonalSpot(sourceHct, true, CONTRAST_LEVEL)

function buildColors(scheme) {
  const out = {}
  for (const [cssName, method] of COLOR_ROLES) {
    out[`md-sys-color-${cssName}`] = hexFromArgb(mdc[method]().getArgb(scheme))
  }
  return out
}

const colorsDark = buildColors(schemeDark)

function buildCustom(name, seedHex) {
  const group = customColor(sourceArgb, {
    value: argbFromHex(seedHex),
    name,
    blend: CUSTOM_BLEND,
  })
  return {
    light: {
      [`md-custom-color-${name}`]: hexFromArgb(group.light.color),
      [`md-custom-color-on-${name}`]: hexFromArgb(group.light.onColor),
      [`md-custom-color-${name}-container`]: hexFromArgb(group.light.colorContainer),
      [`md-custom-color-on-${name}-container`]: hexFromArgb(group.light.onColorContainer),
    },
    dark: {
      [`md-custom-color-${name}`]: hexFromArgb(group.dark.color),
      [`md-custom-color-on-${name}`]: hexFromArgb(group.dark.onColor),
      [`md-custom-color-${name}-container`]: hexFromArgb(group.dark.colorContainer),
      [`md-custom-color-on-${name}-container`]: hexFromArgb(group.dark.onColorContainer),
    },
  }
}

for (const [name, seed] of Object.entries(CUSTOM_SEEDS)) {
  const { dark } = buildCustom(name, seed)
  Object.assign(colorsDark, dark)
}

// -----------------------------------------------------------------------
// 4. Contraste WCAG — vérification des paires réellement composées par l'UI
// -----------------------------------------------------------------------

function hexToRgb(hex) {
  const n = hex.replace('#', '')
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  }
}

function srgbToLinear(c) {
  const cs = c / 255
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

// Chaque paire que le contrat des jetons expose à style.css, canonique M3 ou
// composée par nos alias. min: 4.5 = texte courant (AA), 3 = grand texte ou
// bordure porteuse de sens (AA, SC 1.4.11).
const CONTRAST_PAIRS = [
  // --- Paires canoniques M3 (garanties par la spec, vérifiées quand même) ---
  ['on-primary / primary', 'md-sys-color-on-primary', 'md-sys-color-primary', 4.5],
  [
    'on-primary-container / primary-container',
    'md-sys-color-on-primary-container',
    'md-sys-color-primary-container',
    4.5,
  ],
  ['on-secondary / secondary', 'md-sys-color-on-secondary', 'md-sys-color-secondary', 4.5],
  [
    'on-secondary-container / secondary-container',
    'md-sys-color-on-secondary-container',
    'md-sys-color-secondary-container',
    4.5,
  ],
  ['on-tertiary / tertiary', 'md-sys-color-on-tertiary', 'md-sys-color-tertiary', 4.5],
  [
    'on-tertiary-container / tertiary-container',
    'md-sys-color-on-tertiary-container',
    'md-sys-color-tertiary-container',
    4.5,
  ],
  ['on-error / error', 'md-sys-color-on-error', 'md-sys-color-error', 4.5],
  [
    'on-error-container / error-container',
    'md-sys-color-on-error-container',
    'md-sys-color-error-container',
    4.5,
  ],
  ['on-surface / surface', 'md-sys-color-on-surface', 'md-sys-color-surface', 4.5],
  [
    'inverse-on-surface / inverse-surface',
    'md-sys-color-inverse-on-surface',
    'md-sys-color-inverse-surface',
    4.5,
  ],
  ['on-proposal / proposal', 'md-custom-color-on-proposal', 'md-custom-color-proposal', 4.5],
  [
    'on-proposal-container / proposal-container',
    'md-custom-color-on-proposal-container',
    'md-custom-color-proposal-container',
    4.5,
  ],
  ['on-verified / verified', 'md-custom-color-on-verified', 'md-custom-color-verified', 4.5],
  [
    'on-verified-container / verified-container',
    'md-custom-color-on-verified-container',
    'md-custom-color-verified-container',
    4.5,
  ],

  // --- Paires composées directement dans style.css — pas garanties par M3 ---
  ['on-surface sur surface', 'md-sys-color-on-surface', 'md-sys-color-surface', 4.5],
  // Texte principal sur conteneurs : code, preuves, lignes et cartes.
  [
    'on-surface sur surface-container',
    'md-sys-color-on-surface',
    'md-sys-color-surface-container',
    4.5,
  ],
  // Texte secondaire sur surface : aides, états vides et introduction.
  [
    'on-surface-variant sur surface',
    'md-sys-color-on-surface-variant',
    'md-sys-color-surface',
    4.5,
  ],
  // Texte secondaire sur conteneur : chips et textes de soutien.
  [
    'on-surface-variant sur surface-container',
    'md-sys-color-on-surface-variant',
    'md-sys-color-surface-container',
    4.5,
  ],
  // Primary utilisé comme texte d'accent sur surface et conteneur.
  ['primary (texte) sur surface', 'md-sys-color-primary', 'md-sys-color-surface', 4.5],
  [
    'primary (texte) sur surface-container',
    'md-sys-color-primary',
    'md-sys-color-surface-container',
    4.5,
  ],
  // Texte d'erreur employé hors error-container : bouton danger sur surface.
  [
    'on-error-container sur surface',
    'md-custom-color-error-fallback', // remplacé plus bas par le vrai rôle
    'md-sys-color-surface',
    4.5,
  ],
  // Texte d'erreur dans une carte ou une ligne.
  [
    'on-error-container sur surface-container',
    'md-custom-color-error-fallback',
    'md-sys-color-surface-container',
    4.5,
  ],
  // Outline utilisé comme frontière significative — non-texte, 3:1.
  ['outline sur surface', 'md-sys-color-outline', 'md-sys-color-surface', 3],
  ['outline sur surface-container', 'md-sys-color-outline', 'md-sys-color-surface-container', 3],
]

// Le placeholder évite de répéter le rôle d'erreur au milieu des paires
// canoniques et composées.
for (const pair of CONTRAST_PAIRS) {
  if (pair[1] === 'md-custom-color-error-fallback') pair[1] = 'md-sys-color-on-error-container'
}

function checkPairs(colors, themeName) {
  const results = []
  for (const [label, fgKey, bgKey, min] of CONTRAST_PAIRS) {
    const fg = colors[fgKey]
    const bg = colors[bgKey]
    if (!fg || !bg) {
      throw new Error(
        `Jeton manquant pour la paire "${label}" (${themeName}) : ${fgKey} / ${bgKey}`,
      )
    }
    const ratio = contrastRatio(fg, bg)
    results.push({ label, fg, bg, min, ratio, pass: ratio >= min, theme: themeName })
  }
  return results
}

const resultsDark = checkPairs(colorsDark, 'sombre')
const allResults = resultsDark

const failures = allResults.filter((r) => !r.pass)

// Rapport lisible dans tous les cas (succès ou échec) — utile en CI.
console.log('Contrastes WCAG (relatif au fond, formule sRGB standard) :\n')
for (const r of allResults) {
  const verdict = r.pass ? 'OK ' : 'ECHEC'
  console.log(
    `[${verdict}] ${r.theme.padEnd(6)} ${r.label.padEnd(45)} ${r.ratio.toFixed(2)}:1  (min ${r.min}:1)  ${r.fg} sur ${r.bg}`,
  )
}
console.log('')

if (failures.length > 0) {
  console.error(`${failures.length} paire(s) de contraste en échec. tokens.css n'a pas été écrit.`)
  process.exit(1)
}

// -----------------------------------------------------------------------
// 5. Typographie, forme, élévation, mouvement, opacité — valeurs de spec M3
// -----------------------------------------------------------------------

// Police variable auto-hébergée : aucun appel à Google Fonts au runtime.
// L'interface utilise exclusivement Google Sans Flex.
const TYPEFACE = "'Google Sans Flex Variable'"

// Pile monospace pour le code, les diffs et les preuves (voir style.css) :
// des polices système, aucun fichier à héberger ni licence à suivre. Une
// vraie police à chasse fixe est ce qui rend un diff ou une sortie de
// commande relisibles colonne par colonne — la police proportionnelle du
// corps de texte ne le permet pas.
const TYPEFACE_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', 'Roboto Mono', Consolas, monospace"

// Échelle typographique M3 complète (m3.material.io/styles/typography/type-scale-tokens).
// size/lineHeight en px (convertis en rem dans le CSS), tracking en px (la
// spec M3 exprime le tracking en valeur absolue, pas relative à la taille :
// un `em` aurait explosé le tracking des grandes tailles et écrasé celui
// des petites).
const TYPE_SCALE = [
  ['display-large', 57, 64, 400, -0.25],
  ['display-medium', 45, 52, 400, 0],
  ['display-small', 36, 44, 400, 0],
  ['headline-large', 32, 40, 400, 0],
  ['headline-medium', 28, 36, 400, 0],
  ['headline-small', 24, 32, 400, 0],
  ['title-large', 22, 28, 400, 0],
  ['title-medium', 16, 24, 500, 0.15],
  ['title-small', 14, 20, 500, 0.1],
  ['body-large', 16, 24, 400, 0.5],
  ['body-medium', 14, 20, 400, 0.25],
  ['body-small', 12, 16, 400, 0.4],
  ['label-large', 14, 20, 500, 0.1],
  ['label-medium', 12, 16, 500, 0.5],
  ['label-small', 11, 16, 500, 0.5],
]

// Échelle de forme M3 (m3.material.io/styles/shape/shape-scale-tokens).
const SHAPE_SCALE = [
  ['none', '0px'],
  ['extra-small', '4px'],
  ['small', '8px'],
  ['medium', '12px'],
  ['large', '16px'],
  ['extra-large', '28px'],
  ['full', '9999px'],
]

// Élévation M3 — box-shadow à deux couches (umbra + ambient), valeurs de la
// spec reprises telles quelles de l'implémentation de référence
// @material/web (composant elevation). Identiques en clair et en sombre :
// en sombre, l'élévation est surtout portée par la tonalité de surface.
const ELEVATION = [
  'none',
  '0px 1px 2px 0px rgb(0 0 0 / 30%), 0px 1px 3px 1px rgb(0 0 0 / 15%)',
  '0px 1px 2px 0px rgb(0 0 0 / 30%), 0px 2px 6px 2px rgb(0 0 0 / 15%)',
  '0px 1px 3px 0px rgb(0 0 0 / 30%), 0px 4px 8px 3px rgb(0 0 0 / 15%)',
  '0px 2px 3px 0px rgb(0 0 0 / 30%), 0px 6px 10px 4px rgb(0 0 0 / 15%)',
  '0px 4px 4px 0px rgb(0 0 0 / 30%), 0px 8px 12px 6px rgb(0 0 0 / 15%)',
]

// Mouvement M3 (m3.material.io/styles/motion/easing-and-duration/tokens-specs).
const EASING = {
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  'emphasized-decelerate': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  'emphasized-accelerate': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  'standard-decelerate': 'cubic-bezier(0, 0, 0, 1)',
  'standard-accelerate': 'cubic-bezier(0.3, 0, 1, 1)',
}

const DURATION = {
  short1: 50,
  short2: 100,
  short3: 150,
  short4: 200,
  medium1: 250,
  medium2: 300,
  medium3: 350,
  medium4: 400,
  long1: 450,
  long2: 500,
  long3: 550,
  long4: 600,
  'extra-long1': 700,
  'extra-long2': 800,
  'extra-long3': 900,
  'extra-long4': 1000,
}

// Opacité des state layers M3 (m3.material.io/foundations/interaction/states/state-layers).
const STATE_LAYER_OPACITY = {
  hover: 0.08,
  focus: 0.1,
  pressed: 0.1,
  dragged: 0.16,
}

// -----------------------------------------------------------------------
// 6. Rendu CSS
// -----------------------------------------------------------------------

function colorVars(colors, indent = '  ') {
  return Object.entries(colors)
    .map(([k, v]) => `${indent}--${k}: ${v};`)
    .join('\n')
}

function typeScaleVars(indent = '  ') {
  return TYPE_SCALE.map(([name, size, lineHeight, weight, tracking]) => {
    return [
      `${indent}--md-sys-typescale-${name}-font: var(--md-ref-typeface-plain);`,
      `${indent}--md-sys-typescale-${name}-size: ${(size / 16).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}rem;`,
      `${indent}--md-sys-typescale-${name}-line-height: ${(lineHeight / 16).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}rem;`,
      `${indent}--md-sys-typescale-${name}-weight: ${weight};`,
      `${indent}--md-sys-typescale-${name}-tracking: ${tracking}px;`,
    ].join('\n')
  }).join('\n')
}

function shapeVars(indent = '  ') {
  return SHAPE_SCALE.map(
    ([name, value]) => `${indent}--md-sys-shape-corner-${name}: ${value};`,
  ).join('\n')
}

function elevationVars(indent = '  ') {
  return ELEVATION.map(
    (value, level) => `${indent}--md-sys-elevation-level${level}: ${value};`,
  ).join('\n')
}

function motionVars(indent = '  ') {
  const easings = Object.entries(EASING)
    .map(([name, value]) => `${indent}--md-sys-motion-easing-${name}: ${value};`)
    .join('\n')
  const durations = Object.entries(DURATION)
    .map(([name, value]) => `${indent}--md-sys-motion-duration-${name}: ${value}ms;`)
    .join('\n')
  return `${easings}\n${durations}`
}

function stateLayerVars(indent = '  ') {
  return Object.entries(STATE_LAYER_OPACITY)
    .map(([name, value]) => `${indent}--md-sys-state-${name}-state-layer-opacity: ${value};`)
    .join('\n')
}

function brandGradientValue() {
  const stops = BRAND_GRADIENT_STOPS.map(([hex, pct]) => `${hex} ${pct}%`).join(', ')
  return `linear-gradient(${BRAND_GRADIENT_ANGLE}deg, ${stops})`
}

function brandVars(indent = '  ') {
  return [
    `${indent}--brand-gradient: ${brandGradientValue()};`,
    `${indent}--brand-highlight: ${BRAND_HIGHLIGHT};`,
    `${indent}--brand-on-highlight: ${BRAND_ON_HIGHLIGHT};`,
  ].join('\n')
}

const STATIC_BLOCK = `
  /* Typographie — famille de police partagée par toute l'échelle. */
  --md-ref-typeface-plain: ${TYPEFACE};
  --md-ref-typeface-brand: ${TYPEFACE};
  --md-ref-typeface-mono: ${TYPEFACE_MONO};

${typeScaleVars()}

  /* Forme */
${shapeVars()}

  /* Élévation */
${elevationVars()}

  /* Mouvement */
${motionVars()}

  /* State layers */
${stateLayerVars()}

  /* Espacement — grille 4dp M3. Consommé tel quel par style.css. */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;

  /* Largeurs de mise en page — pas des jetons M3, des contraintes de lecture propres au produit. */
  --measure: 680px;
  --dashboard: 880px;

  /*
   * Jetons de marque — PAS des rôles M3. Valeurs de la maquette Figma
   * (dégradé de marque et surligneur), isolées ici et commentées en tête de
   * script (voir section 1). Émis par ce script pour que tokens.css reste
   * entièrement régénérable ; ne jamais les taper à la main dans le CSS.
   */
${brandVars()}`.replace(/\n\n\n+/g, '\n\n')

const HEADER = `/*
 * Jetons visuels — Material Design 3, généré depuis une seule couleur-source.
 *
 * Contrat : les rôles de couleur, la typographie, les formes et le mouvement
 * viennent d'ici. La feuille de composants consomme directement les noms M3,
 * sans alias intermédiaire propre au projet.
 *
 * NE PAS ÉDITER LES COULEURS À LA MAIN. Ce fichier est produit par
 * scripts/generate-tokens.mjs à partir de :
 *   - couleur-source : ${SOURCE} (vert de marque)
 *   - custom color "proposal" : ${CUSTOM_SEEDS.proposal} (ambre — une proposition d'agent non endossée)
 *   - custom color "verified" : ${CUSTOM_SEEDS.verified} (bleu — un fait confirmé par un humain)
 * Pour changer la charte, éditer les constantes en tête du script et le
 * relancer (\`node scripts/generate-tokens.mjs\`) — jamais ce fichier.
 *
 * Deux jetons de marque s'ajoutent aux rôles M3 ci-dessus : \`--brand-gradient\`
 * et \`--brand-highlight\` (+ \`--brand-on-highlight\`). Ce ne sont pas des rôles
 * M3 — ce sont des valeurs de marque relevées telles quelles dans la maquette
 * Figma (fills bruts, aucune variable n'y est déclarée). Elles sont émises par
 * ce script, dans un bloc clairement séparé et commenté, pour que tokens.css
 * reste entièrement régénérable — y compris ces deux valeurs — sans qu'aucune
 * couleur n'ait jamais à être tapée à la main dans le CSS.
 *
 * Le produit n'a qu'un thème : sombre. \`:root\` porte ces valeurs. Il n'y a
 * plus de bascule clair, ni de suivi de \`prefers-color-scheme\`.
 */

:root {
  color-scheme: dark;

${colorVars(colorsDark)}
${STATIC_BLOCK}
}
`

writeFileSync(OUTPUT_PATH, HEADER, 'utf8')
console.log(`tokens.css écrit (${failures.length === 0 ? 'toutes les paires passent' : 'échec'}).`)
