import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// The service worker cannot know fingerprinted names in advance: its precache
// list named neither of the two files the application is made of, and an audit
// found a blank page offline after a single visit, where the README announces
// the opposite. The cache name changes with the list: without this `activate`
// never deleted anything and a faulty entry survived every deployment that
// followed.
const dist = fileURLToPath(new URL('../dist/', import.meta.url))

const actifs = (await readdir(join(dist, 'assets')))
  .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  .map((f) => `/assets/${f}`)
  .sort()

if (actifs.length === 0) {
  console.error('precache : dist/assets contains no files. Did the build run?')
  process.exit(1)
}

const path = join(dist, 'sw.js')
const source = await readFile(path, 'utf8')
const shell = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', ...actifs]
const version = createHash('sha256').update(shell.join('|')).digest('hex').slice(0, 12)

const written = source
  .replace(/^const CACHE = .*$/m, `const CACHE = 'keydler-${version}'`)
  .replace(/^const SHELL = .*$/m, `const SHELL = ${JSON.stringify(shell)}`)

if (written === source) {
  console.error('precache : found neither CACHE nor SHELL in dist/sw.js')
  process.exit(1)
}

await writeFile(path, written)
console.log(`precache : ${shell.length} entries, cache keydler-${version}`)
