#!/usr/bin/env node
/**
 * Optimise les objets 3D du semis de la bannière de marque.
 *
 * Source : assets-src/brand/*.png — les PNG bruts récupérés de Figma. Chaque
 * fichier est un canevas de 4096×2234 avec un canal alpha réel, l'objet
 * n'occupant qu'une petite fraction du canevas (le reste est transparent).
 * Servir ce fichier tel quel coûtait ~1 Mo par objet pour un rendu à moins de
 * 130px de large — inacceptable pour un premier rendu.
 *
 * Sortie : public/assets/brand/*.webp — recadrés sur la boîte englobante du
 * contenu opaque (+ marge pour ne pas couper l'ombre portée), redimensionnés
 * à la taille d'affichage maximale × 3 (écrans à forte densité), convertis
 * en WebP.
 *
 * Rejouable : `node scripts/process-brand-assets.mjs` régénère les trois
 * fichiers de sortie à l'identique tant que les sources dans assets-src/ et
 * les constantes ci-dessous ne changent pas — même contrat que
 * generate-tokens.mjs. Si Kymra régénère de nouveaux objets depuis Figma,
 * elle les dépose dans assets-src/brand/ (mêmes noms de fichiers) et relance
 * ce script ; rien d'autre à retoucher.
 */

/* global console */

import sharp from 'sharp'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.join(__dirname, '..', 'assets-src', 'brand')
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'brand')

// ×3 pour couvrir les écrans à forte densité (2x, 3x) sans jamais re-servir
// le canevas Figma intégral.
const DENSITY_FACTOR = 3

// Qualité WebP. 82 est le point où l'œil ne distingue plus les artefacts sur
// ce type de rendu (dégradés doux, pas de texte ni de bords durs) tout en
// restant nettement sous la cible de 40 Ko.
const WEBP_QUALITY = 82

/**
 * Un objet par entrée.
 *
 * `displayMax` est la largeur d'affichage MAXIMALE de l'objet dans le CSS —
 * la borne haute du `clamp()` qui le dimensionne. La changer dans
 * src/marketing.css sans la changer ici sert une image floue (trop petite) ou
 * inutilement lourde (trop grande).
 *
 * `margin` est la marge laissée autour de la boîte englobante alpha. Elle
 * existe pour ne pas couper l'ombre portée ni le halo du rendu. Le personnage
 * en reçoit beaucoup moins que les objets du semis : il est ancré par son bras
 * d'appui sur l'arête d'une carte, et chaque pixel transparent supplémentaire
 * décale ce point de contact d'autant.
 */
const OBJECTS = [
  { name: 'cube', displayMax: 128, margin: 32 }, // .brand-hero__shape--cube
  { name: 'cylinder', displayMax: 128, margin: 32 }, // .brand-hero__shape--cylinder
  { name: 'gem', displayMax: 156, margin: 32 }, // .brand-hero__shape--gem
  { name: 'mascot', displayMax: 320, margin: 6 }, // .reason-card__mascot
  { name: 'controls', displayMax: 260, margin: 8 }, // .reason-card__icon, carte 1
  { name: 'puzzle', displayMax: 260, margin: 8 }, // .reason-card__icon, carte 2
  { name: 'ledger', displayMax: 260, margin: 8 }, // .reason-card__icon, carte 3
]

/*
 * `withoutEnlargement: true` sur le resize plus bas veut dire qu'une source
 * trop PETITE n'est jamais agrandie : elle sort telle quelle, et le navigateur
 * l'étire à l'affichage — c'est-à-dire flou sur tout écran à forte densité.
 * Le script le signale au lieu de le laisser passer en silence.
 */

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

for (const { name, displayMax, margin: TRIM_MARGIN_PX } of OBJECTS) {
  const TARGET_MAX_PX = displayMax * DENSITY_FACTOR
  const srcPath = path.join(SRC_DIR, `${name}.png`)
  const outPath = path.join(OUT_DIR, `${name}.webp`)

  // 1. Recadre sur la boîte englobante du contenu non transparent. sharp
  //    compare chaque bord à la couleur du pixel (0,0) — ici transparent —
  //    donc ça revient à recadrer sur l'alpha, exactement ce qu'on veut.
  const { data: trimmedData, info: trimmedInfo } = await sharp(srcPath)
    .trim({ threshold: 10 })
    .toBuffer({ resolveWithObject: true })

  // 2. Marge de sécurité autour du recadrage. Matérialisée dans un buffer à
  //    part (et non chaînée directement sur le `resize` suivant) : sharp
  //    calcule alors `resize({ fit: 'inside' })` sur les dimensions
  //    POST-extend correctes. Chaîné sans ce passage par un buffer
  //    intermédiaire, sharp 0.35 dimensionne le résultat sur des métadonnées
  //    pré-extend et sort une image ~15 % trop grande (448px au lieu de
  //    384px demandés) — constaté empiriquement, pas documenté en amont.
  const { data: extendedData } = await sharp(trimmedData)
    .extend({
      top: TRIM_MARGIN_PX,
      bottom: TRIM_MARGIN_PX,
      left: TRIM_MARGIN_PX,
      right: TRIM_MARGIN_PX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer({ resolveWithObject: true })

  // 3. Mise à la taille cible. `fit: 'inside'` préserve le ratio de l'objet —
  //    les trois n'ont pas la même silhouette, un carré forcé les aurait
  //    déformés.
  const result = await sharp(extendedData)
    .resize({
      width: TARGET_MAX_PX,
      height: TARGET_MAX_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outPath)

  const kb = (result.size / 1024).toFixed(1)
  const tropPetit = result.width < TARGET_MAX_PX && result.height < TARGET_MAX_PX
  const verdict = tropPetit
    ? `SOURCE TROP PETITE — ${result.width}px pour ${displayMax}px d'affichage, ` +
      `soit ${(result.width / displayMax).toFixed(2)}× ; il en faut 3× (${TARGET_MAX_PX}px) ` +
      `pour rester net sur un écran à forte densité`
    : result.size <= 40 * 1024
      ? 'OK'
      : 'DÉPASSE 40 Ko'
  console.log(
    `${name}: ${trimmedInfo.width}×${trimmedInfo.height} rogné → ${result.width}×${result.height} webp, ${kb} Ko [${verdict}]`,
  )
}
