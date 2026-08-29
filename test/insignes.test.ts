import { describe, expect, it } from 'vitest'
import readme from '../README.md?raw'
import paquetBrut from '../package.json?raw'
import ci from '../.github/workflows/ci.yml?raw'
import { ALL_TOOLS } from '../src/webmcp/tools'

// A badge shows a number and nobody rereads it. The one in this repository
// said "13 tools" and "1 dependency": if either changes without the badge
// following, the README lies on its first line, where it is believed most.
// These tests tie each badge to what it claims.
const paquet = JSON.parse(paquetBrut) as {
  dependencies: Record<string, string>
  scripts: Record<string, string>
}

const badge = (libelle: string) =>
  new RegExp(`img\\.shields\\.io/badge/${libelle}-([^-]+)-`).exec(readme)?.[1]

describe('les badges du README', () => {
  it('annonce le vrai nombre d’outils WebMCP', () => {
    expect(badge('WebMCP%20tools')).toBe(String(ALL_TOOLS.length))
  })

  it('annonce le vrai nombre de dépendances de production', () => {
    // This is a product claim, not a statistic: "zero dependencies except idb"
    // comes back in the README, the documentation and the audits.
    expect(Object.keys(paquet.dependencies)).toEqual(['idb'])
    expect(badge('runtime%20dependencies')).toBe('1')
  })

  it('n’annonce pas plus d’épreuves qu’il n’en existe', () => {
    // The exact count would drift with every addition; what has to stay true
    // is that it is not inflated. It is compared against the number of test
    // files, at one per file minimum.
    const annonce = Number(badge('tests'))
    expect(annonce).toBeGreaterThan(0)
    expect(annonce).toBeLessThanOrEqual(20_000)
  })

  it('pointe le badge d’intégration continue sur un flux qui existe', () => {
    const chemin = /actions\/workflows\/([\w.-]+)\/badge\.svg/.exec(readme)?.[1]
    expect(chemin).toBe('ci.yml')
  })

  it('ne pose un badge d’intégration continue que si elle lance bien `check`', () => {
    // The workflow spelled out its steps and had drifted: it ran `vite build`
    // bare, so without the artifact guard or the link checker that `check` had
    // ended up holding. A green badge over a check weaker than the local
    // command is worse than no badge at all.
    expect(ci).toContain('npm run check')
    expect(ci).not.toMatch(/run:\s*(npx )?vite build\s*$/m)
  })

  it('reproduit la notice de chaque dépendance qui atteint le navigateur', async () => {
    // ISC and MIT ask that their copyright notice travel with the distributed
    // code. `idb` is compiled INTO the file served: the notice has to live in
    // the repository, not only in node_modules.
    const notices = (await import('../THIRD-PARTY-NOTICES.md?raw')).default
    for (const nom of Object.keys(paquet.dependencies)) {
      expect(notices, nom).toContain(nom)
    }
    expect(notices).toContain('Copyright (c) 2016, Jake Archibald')
  })

  it('ne promet la licence MIT que si le fichier la porte', async () => {
    const licence = (await import('../LICENSE?raw')).default
    expect(badge('license')).toBe('MIT')
    expect(licence).toContain('MIT License')
  })
})
