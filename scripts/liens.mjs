import { readFile, readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

// Every target is resolved RELATIVE to the file that cites it, which a pattern
// search cannot do. External addresses are ignored: checking them would need
// the network and would make the gate depend on third party sites.
const racine = fileURLToPath(new URL('../', import.meta.url))

async function files(directory) {
  const trouves = []
  for (const e of await readdir(directory, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.git')) continue
    const path = join(directory, e.name)
    if (e.isDirectory()) trouves.push(...(await files(path)))
    else if (e.name.endsWith('.md')) trouves.push(path)
  }
  return trouves
}

// `<...>` around a target is valid Markdown, and prettier adds it around URLs
// that contain special characters. Without that case, the checker took an
// external address for a relative path.
const LIEN = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
const morts = []
let comptes = 0

for (const file of await files(racine)) {
  const text = await readFile(file, 'utf8')
  for (const [, cible] of text.matchAll(LIEN)) {
    if (/^(https?:|mailto:|#)/.test(cible)) continue
    comptes++
    const sansAncre = cible.split('#')[0]
    if (sansAncre === '') continue
    const absolu = resolve(dirname(file), sansAncre)
    try {
      await access(absolu)
    } catch {
      morts.push(`${relative(racine, file)} → ${cible}`)
    }
  }
}

for (const m of morts) console.error(`  MORT  ${m}`)
console.log(`\n${comptes - morts.length}/${comptes} liens internes résolvent`)
if (morts.length > 0) process.exit(1)
