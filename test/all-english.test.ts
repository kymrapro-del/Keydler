import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// This guard reads every text file in the repository. Earlier versions used a
// hand-written directory list or inspected comments only, which let public
// files, configuration, documentation and string literals escape the check.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.wrangler',
  'assets',
  'icons',
])

const BINARY = /\.(png|ico|jpe?g|gif|webp|svg|woff2?|ttf|otf|pdf|mp4|webm|zip)$/i
const SKIPPED_FILES = new Set(['package-lock.json'])
const EXEMPT = ['test/all-english.test.ts']

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, found)
    else if (!BINARY.test(entry) && !SKIPPED_FILES.has(entry)) found.push(path)
  }
  return found
}

const FILES = walk(ROOT)
  .map((path) => [relative(ROOT, path), path] as const)
  .filter(([name]) => !EXEMPT.includes(name))
  .map(([name, path]) => {
    const source = readFileSync(path, 'utf8')
    return source.includes('\0') ? null : ([name, source] as const)
  })
  .filter((entry): entry is readonly [string, string] => entry !== null)

const PATHS =
  /[\w./-]*\.(?:d\.mts|ts|mts|js|mjs|cjs|md|json|jsonc|css|html|xml|txt|yml|yaml|webmanifest|sh)\b|https?:\/\/\S+/g

// These terms have no common English homograph. This file alone is exempt
// because a language detector necessarily contains the language it rejects.
const FRENCH =
  /\b(le|les|des|une|est|pas|que|qui|pour|dans|donc|mais|cela|aux|leur|leurs|elle|elles|etre|avoir|cette|cet|ces|sont|fait|tout|toute|toutes|tous|nous|vous|un|du|au|ou|vers|chez|aussi|alors|quand|comme|peut|doit|sous|entre|meme|deja|jamais|ainsi|plutot|depuis|apres|etait|avait|faut|celui|celle|ceux|notre|votre|ses|mes|ne|reste|ici|humain|identifiant|authentification|cartographier|scellement|cahier|fichier|outil|preuve|jeton|mesure|echelle|lien|recherche|erreur|echec|reussi|attendu|vide|attente|autorisation|regle|etape|titre|bouton|champ|nom)\b/i
const FRENCH_ACCENTS =
  /[\u00e0\u00e2\u00e7\u00e8-\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u0153]/i
const EM_DASH = String.fromCodePoint(0x2014)

// This exact IndexedDB and channel key predates the English migration. Changing
// it would strand existing browser data, so it remains a compatibility token,
// not user-facing prose.
const prose = (line: string) => line.replaceAll('cahier-de-quart', ' ').replace(PATHS, ' ')
const numbered = (source: string) => source.split('\n').map((line, i) => [i + 1, line] as const)

const offenders = (holds: (line: string) => boolean) =>
  FILES.flatMap(([name, source]) =>
    numbered(source)
      .filter(([, line]) => holds(line))
      .map(([n, line]) => `${name}:${n}  ${line.trim().slice(0, 90)}`),
  )

function markdownProse(source: string): string[] {
  let fenced = false
  return source.split('\n').filter((line) => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      return false
    }
    return !fenced
  })
}

describe('the repository speaks one language', () => {
  it('has no French left in any readable file', () => {
    expect(
      offenders(
        (line) => FRENCH.test(prose(line).normalize('NFD')) || FRENCH_ACCENTS.test(prose(line)),
      ),
    ).toEqual([])
  })

  it('has no French path names', () => {
    const frenchPath =
      /(^|[-/])(echelle|concours|deploiement|mesures?|resultats|taches|protocoles?|reprise|manuel|annuler|attente|autorisation|changements|confiance|contestation|durabilite|edition|onglets|finitions|historique|identifiants|insignes|inspecteur|liaison|lien|limites|nettoyage|outil|outils|preuve|prochaine|raccourcis|recherche|redondance|temoin|temps|tout|vue)([-./]|$)/i
    expect(FILES.map(([name]) => name).filter((name) => frenchPath.test(name))).toEqual([])
  })

  it('has no em dash in any readable file', () => {
    expect(offenders((line) => line.includes(EM_DASH))).toEqual([])
  })

  it('puts a space before colons in prose', () => {
    const failures = FILES.filter(
      ([name]) => /\.(md|txt)$/i.test(name) && name !== 'public/robots.txt',
    ).flatMap(([name, source]) =>
      markdownProse(source).flatMap((line, index) => {
        const plain = line.replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '')
        return /[\p{L})\]]:/u.test(plain)
          ? [`${name}:${index + 1}  ${line.trim().slice(0, 90)}`]
          : []
      }),
    )
    expect(failures).toEqual([])
  })

  it('covers the file shapes that escaped earlier checks', () => {
    expect(FILES.length).toBeGreaterThan(180)
    const names = FILES.map(([name]) => name)
    for (const expected of [
      'wrangler.jsonc',
      'public/_headers',
      'public/robots.txt',
      '.env.production',
      '.github/workflows/ci.yml',
      'docs/README.md',
      'src/tokens.css',
    ]) {
      expect(names, `${expected} fell out of the walk`).toContain(expected)
    }
    expect(names.some((name) => name.startsWith('bench/'))).toBe(true)
    expect(names.some((name) => name.startsWith('workers/'))).toBe(true)
  })
})
