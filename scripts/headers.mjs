import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// The only inline script (the theme bootstrap, run before the first paint to
// avoid a flash) is allowed by its hash, not by `'unsafe-inline'` which would
// empty the policy of its point. `vercel.json` is read from the repo at deploy
// time and can receive nothing computed: it carries the hash hard-coded and
// this script checks that it still matches, a policy that has drifted being
// reassuring without protecting.
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

const html = await readFile(join(dist, 'index.html'), 'utf8')

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
if (scripts.length !== 1) {
  console.error(
    `headers : found ${scripts.length} inline scripts, expected exactly one.\n` +
      'Adding or removing one requires updating its hash.',
  )
  process.exit(1)
}

const fingerprint = `sha256-${createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')}`

const path = join(dist, '_headers')
const modele = await readFile(path, 'utf8')
if (!modele.includes('__CSP_SCRIPT_HASH__')) {
  console.error('headers: __CSP_SCRIPT_HASH__ absent de dist/_headers')
  process.exit(1)
}
await writeFile(path, modele.replaceAll('__CSP_SCRIPT_HASH__', fingerprint))

const vercel = await readFile(join(root, 'vercel.json'), 'utf8')
if (!vercel.includes(fingerprint)) {
  console.error(
    `headers : vercel.json does not contain the inline script hash.\n` +
      `Attendue : ${fingerprint}\n` +
      'The bootstrap script changed : copy this value into vercel.json.',
  )
  process.exit(1)
}

console.log(`headers : policy sealed with ${fingerprint}`)
