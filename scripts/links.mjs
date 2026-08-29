import { readFile, readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

// Every target is resolved relative to the file that cites it, which a pattern
// search cannot do. External addresses are ignored: checking them would need
// the network and would make the gate depend on third party sites.
const root = fileURLToPath(new URL('../', import.meta.url))

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
const LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
const deadLinks = []
let comptes = 0

for (const file of await files(root)) {
  const text = await readFile(file, 'utf8')
  for (const [, target] of text.matchAll(LINK)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue
    comptes++
    const sansAncre = target.split('#')[0]
    if (sansAncre === '') continue
    const absolu = resolve(dirname(file), sansAncre)
    try {
      await access(absolu)
    } catch {
      deadLinks.push(`${relative(root, file)} → ${target}`)
    }
  }
}

for (const m of deadLinks) console.error(`  DEAD  ${m}`)
console.log(`\n${comptes - deadLinks.length}/${comptes} internal links resolve`)
if (deadLinks.length > 0) process.exit(1)
