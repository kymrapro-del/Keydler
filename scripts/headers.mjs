import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Le seul script en ligne — l'amorce de thème, exécutée avant la première
// peinture pour éviter un clignotement — est autorisé par son empreinte, pas
// par `'unsafe-inline'` qui viderait la politique de son intérêt. `vercel.json`
// est lu depuis le dépôt au déploiement et ne peut rien recevoir de calculé :
// il porte l'empreinte en dur et ce script vérifie qu'elle correspond encore,
// une politique qui a dérivé rassurant sans protéger.
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const racine = fileURLToPath(new URL('../', import.meta.url))

const html = await readFile(join(dist, 'index.html'), 'utf8')

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
if (scripts.length !== 1) {
  console.error(
    `headers: ${scripts.length} script(s) en ligne trouvé(s), un seul est attendu.\n` +
      "En ajouter un exige d'ajouter son empreinte ; en retirer un exige de retirer la sienne.",
  )
  process.exit(1)
}

const empreinte = `sha256-${createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')}`

const chemin = join(dist, '_headers')
const modele = await readFile(chemin, 'utf8')
if (!modele.includes('__CSP_SCRIPT_HASH__')) {
  console.error('headers: __CSP_SCRIPT_HASH__ absent de dist/_headers')
  process.exit(1)
}
await writeFile(chemin, modele.replaceAll('__CSP_SCRIPT_HASH__', empreinte))

const vercel = await readFile(join(racine, 'vercel.json'), 'utf8')
if (!vercel.includes(empreinte)) {
  console.error(
    `headers: vercel.json ne porte pas l'empreinte du script en ligne.\n` +
      `Attendue : ${empreinte}\n` +
      "Le script d'amorce a changé : reportez cette valeur dans vercel.json.",
  )
  process.exit(1)
}

console.log(`headers: politique scellée sur ${empreinte}`)
