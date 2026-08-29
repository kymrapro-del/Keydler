import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Le service worker ne peut pas connaître à l'avance des noms empreintés : sa
// liste de précache ne citait aucun des deux fichiers dont l'application est
// faite, et un audit a trouvé une page blanche hors ligne après une seule
// visite, là où le README annonce le contraire. Le nom de cache change avec la
// liste : sans cela `activate` ne supprimait jamais rien et une entrée fautive
// survivait à tous les déploiements suivants.
const dist = fileURLToPath(new URL('../dist/', import.meta.url))

const actifs = (await readdir(join(dist, 'assets')))
  .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  .map((f) => `/assets/${f}`)
  .sort()

if (actifs.length === 0) {
  console.error('precache: aucun fichier dans dist/assets. La construction a-t-elle eu lieu ?')
  process.exit(1)
}

const chemin = join(dist, 'sw.js')
const source = await readFile(chemin, 'utf8')
const shell = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', ...actifs]
const version = createHash('sha256').update(shell.join('|')).digest('hex').slice(0, 12)

const écrit = source
  .replace(/^const CACHE = .*$/m, `const CACHE = 'keydler-${version}'`)
  .replace(/^const SHELL = .*$/m, `const SHELL = ${JSON.stringify(shell)}`)

if (écrit === source) {
  console.error('precache: ni CACHE ni SHELL trouvés dans dist/sw.js')
  process.exit(1)
}

await writeFile(chemin, écrit)
console.log(`precache: ${shell.length} entrées, cache keydler-${version}`)
