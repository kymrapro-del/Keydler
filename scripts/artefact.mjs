import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { lireJeton } from './jeton.mjs'

// `dist/` can look complete and not be deployable: two substitutions happen
// AFTER `vite build`. Without them the CSP carries `'__CSP_SCRIPT_HASH__'`,
// which is not a valid source and gets the theme bootstrap script BLOCKED, and
// the service worker precaches nothing under the fixed cache name
// `keydler-dev`, which never invalidates. None of this shows by looking at the
// folder.
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
  // The template already carries a SHELL list, but it only names files with
  // fixed names. What tells a substituted artifact from another one is that it
  // names the FINGERPRINTED files actually produced. The template writes it in
  // JavaScript, the substituted version in JSON: we pick up the paths named
  // without assuming which of the two we are reading.
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

// The fingerprint has to match the HTML actually built, and `vercel.json` holds
// it hard-coded: it is read from the repository at deploy time, not from dist.
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
        `Reportez ${attendue} dans vercel.json. Une politique périmée rassure sans protéger.`,
      )
    }
  }
}

// Everything else can be perfect and the product stay invisible: without an
// origin trial token valid for the origin served, `document.modelContext` does
// not exist and a judge reads "WebMCP is not available in this browser".
// `ALLOW_NO_ORIGIN_TRIAL=1` lifts the requirement: that is what `npm run check`
// does, building to verify, not to publish.
const ORIGINES_SERVIES = ['https://keydler.com', 'https://keydler.pages.dev']
const FONCTIONNALITE = 'WebMCP'

if (html !== null && process.env.ALLOW_NO_ORIGIN_TRIAL !== '1') {
  const balises = [...html.matchAll(/<meta\s+http-equiv="origin-trial"\s+content="([^"]*)"/g)].map(
    (m) =>
      m[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&'),
  )

  if (balises.length === 0) {
    grief(
      'dist/index.html ne porte aucune balise origin-trial.',
      'WebMCP ne s’activerait que derrière chrome://flags, et rien ne le dirait.',
    )
  }

  const couvertes = new Set()
  for (const brut of balises) {
    const jeton = lireJeton(brut)
    if (jeton.erreur) {
      grief(`Un jeton origin-trial est illisible : ${jeton.erreur}.`, 'Recopiez-le tel qu’émis.')
      continue
    }
    if (jeton.fonctionnalite !== FONCTIONNALITE) {
      grief(
        `Un jeton porte la fonctionnalité « ${jeton.fonctionnalite} », pas « ${FONCTIONNALITE} ».`,
        'Il n’activera pas WebMCP.',
      )
      continue
    }
    if (jeton.tiers) {
      grief(
        `Le jeton pour ${jeton.origine} est un jeton « third-party ».`,
        'Ceux-là ne valent qu’injectés depuis un script tiers, jamais dans le HTML d’une page.',
      )
      continue
    }
    // The token origin includes the port (`https://keydler.com:443`) while the
    // origin served does not write it. We compare on the origin prefix.
    const origine = String(jeton.origine ?? '').replace(/:443$/, '')
    if (!ORIGINES_SERVIES.includes(origine)) {
      grief(
        `Un jeton est émis pour « ${jeton.origine} », qui n’est pas une origine servie.`,
        `Attendu l’une de : ${ORIGINES_SERVIES.join(', ')}. Une origine qui ne correspond pas échoue en silence.`,
      )
      continue
    }
    if (jeton.expire === null) {
      grief(
        `Le jeton pour ${origine} n’a pas de date d’expiration lisible.`,
        'Charge utile douteuse.',
      )
      continue
    }
    if (jeton.expire.getTime() <= Date.now()) {
      grief(
        `Le jeton pour ${origine} a expiré le ${jeton.expire.toISOString().slice(0, 10)}.`,
        'Chrome vérifie le jeton hors ligne : aucun rattrapage n’est possible après le déploiement.',
      )
      continue
    }
    couvertes.add(origine)
  }

  const canonique = ORIGINES_SERVIES[0]
  if (balises.length > 0 && !couvertes.has(canonique)) {
    grief(
      `Aucun jeton valide ne couvre ${canonique}, l’origine canonique.`,
      'C’est celle que verront les juges.',
    )
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
