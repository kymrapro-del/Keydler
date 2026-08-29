import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * `dist/` peut avoir l'air complet et n'être pas déployable.
 *
 * `vite build` seul produit les onze bons fichiers, aux bons noms. Mais deux
 * substitutions se font APRÈS lui — `precache.mjs` écrit les noms réellement
 * construits dans le service worker, `headers.mjs` scelle la politique sur
 * l'empreinte du script en ligne. Sans elles :
 *
 *   - la CSP porte `'__CSP_SCRIPT_HASH__'`, qui n'est pas une source valide.
 *     Le script d'amorce du thème est alors BLOQUÉ par le navigateur ;
 *   - le service worker ne précharge rien et s'appelle `keydler-dev`, un nom
 *     fixe qui ne s'invalide jamais d'un déploiement à l'autre.
 *
 * Rien de tout cela ne se voit en regardant le dossier. Ce script refuse
 * l'artefact plutôt que de compter sur la vigilance de qui déploie — le jour
 * où l'on déploie vite est précisément celui où l'on ne vérifie pas.
 */
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const racine = fileURLToPath(new URL('../', import.meta.url))

const griefs = []
const grief = (quoi, pourquoi) => griefs.push(`${quoi}\n    ${pourquoi}`)

const lire = async (chemin) => {
  try {
    return await readFile(join(dist, chemin), 'utf8')
  } catch {
    grief(`dist/${chemin} est absent.`, 'La construction ne s’est pas terminée.')
    return null
  }
}

const headers = await lire('_headers')
const sw = await lire('sw.js')
const html = await lire('index.html')

if (headers?.includes('__CSP_SCRIPT_HASH__')) {
  grief(
    'dist/_headers porte encore __CSP_SCRIPT_HASH__.',
    'La CSP servie bloquerait le script d’amorce. `scripts/headers.mjs` n’a pas tourné.',
  )
}

const construits = (await readdir(join(dist, 'assets')).catch(() => [])).map((f) => `/assets/${f}`)

if (sw !== null) {
  // Le gabarit porte déjà une liste SHELL, mais elle ne cite que des fichiers
  // aux noms fixes. Ce qui distingue un artefact substitué d'un autre, c'est
  // qu'elle nomme les fichiers EMPREINTÉS réellement produits. Le gabarit
  // l'écrit en JavaScript, la version substituée en JSON : on relève les
  // chemins cités sans supposer laquelle des deux on lit.
  const shell = /const SHELL = (\[[^\]]*\])/.exec(sw)?.[1]
  const empreintés = [...(shell ?? '').matchAll(/['"](\/assets\/[^'"]+)['"]/g)].map((m) => m[1])

  if (shell === undefined) {
    grief('dist/sw.js ne contient aucune liste SHELL.', '`scripts/precache.mjs` n’a pas tourné.')
  } else if (empreintés.length === 0) {
    grief(
      'dist/sw.js ne précharge aucun fichier de dist/assets.',
      'Hors ligne, la page se chargerait sans son script ni sa feuille de style.',
    )
  } else {
    const fantômes = empreintés.filter((p) => !construits.includes(p))
    if (fantômes.length > 0) {
      grief(
        `dist/sw.js précharge ${fantômes.length} fichier(s) qui n’existe(nt) pas : ${fantômes.join(', ')}`,
        'Le préchargement échouerait et le service worker ne s’installerait pas.',
      )
    }
  }

  const cache = /const CACHE = '([^']*)'/.exec(sw)?.[1] ?? ''
  if (cache === '' || cache.endsWith('-dev')) {
    grief(
      `dist/sw.js garde le nom de cache « ${cache || '(vide)'} ».`,
      'Un nom fixe ne s’invalide jamais : les visiteurs garderaient l’ancienne version.',
    )
  }
}

// L'empreinte doit correspondre au HTML réellement construit, et `vercel.json`
// la porte en dur — il est lu depuis le dépôt au déploiement, pas depuis dist.
if (html !== null && headers !== null) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  if (scripts.length !== 1) {
    grief(
      `dist/index.html contient ${scripts.length} script(s) en ligne, un seul est attendu.`,
      'Chaque script en ligne doit être autorisé par son empreinte.',
    )
  } else {
    const attendue = `sha256-${createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')}`
    if (!headers.includes(attendue)) {
      grief(
        'dist/_headers ne porte pas l’empreinte du script réellement construit.',
        `Attendue : ${attendue}`,
      )
    }
    const vercel = await readFile(join(racine, 'vercel.json'), 'utf8')
    if (!vercel.includes(attendue)) {
      grief(
        'vercel.json a dérivé de l’empreinte du script en ligne.',
        `Reportez ${attendue} dans vercel.json — une politique périmée rassure sans protéger.`,
      )
    }
  }
}

const cartes = construits.filter((f) => f.endsWith('.map'))
if (cartes.length > 0) {
  grief(
    `dist/assets contient ${cartes.length} carte(s) de source.`,
    'Elles publient le code d’origine ; construisez sans SOURCEMAP=1.',
  )
}

if (griefs.length > 0) {
  console.error(`artefact: ${griefs.length} raison(s) de ne pas déployer ce dossier.\n`)
  for (const g of griefs) console.error(`  - ${g}\n`)
  console.error('Reconstruisez avec `npm run build` (ou `build:trial`), pas `vite build` seul.')
  process.exit(1)
}

console.log('artefact: dist/ est déployable.')
