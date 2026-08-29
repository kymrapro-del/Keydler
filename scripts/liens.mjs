import { readFile, readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

// Chaque cible est résolue RELATIVEMENT au fichier qui la cite, ce qu'une
// recherche par motif ne peut pas faire. Les adresses externes sont ignorées :
// les vérifier demanderait le réseau et rendrait la barrière dépendante de
// sites tiers.
const racine = fileURLToPath(new URL('../', import.meta.url))

async function fichiers(dossier) {
  const trouves = []
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.git')) continue
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) trouves.push(...(await fichiers(chemin)))
    else if (e.name.endsWith('.md')) trouves.push(chemin)
  }
  return trouves
}

// `<...>` autour d'une cible est du Markdown valide, et prettier l'ajoute
// autour des URL qui contiennent des caractères spéciaux. Sans ce cas, le
// vérificateur prenait une adresse externe pour un chemin relatif.
const LIEN = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
const morts = []
let comptes = 0

for (const fichier of await fichiers(racine)) {
  const texte = await readFile(fichier, 'utf8')
  for (const [, cible] of texte.matchAll(LIEN)) {
    if (/^(https?:|mailto:|#)/.test(cible)) continue
    comptes++
    const sansAncre = cible.split('#')[0]
    if (sansAncre === '') continue
    const absolu = resolve(dirname(fichier), sansAncre)
    try {
      await access(absolu)
    } catch {
      morts.push(`${relative(racine, fichier)} → ${cible}`)
    }
  }
}

for (const m of morts) console.error(`  MORT  ${m}`)
console.log(`\n${comptes - morts.length}/${comptes} liens internes résolvent`)
if (morts.length > 0) process.exit(1)
