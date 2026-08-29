import { describe, expect, it } from 'vitest'
import readme from '../README.md?raw'
import paquetBrut from '../package.json?raw'
import ci from '../.github/workflows/ci.yml?raw'
import { ALL_TOOLS } from '../src/webmcp/tools'

// Every test file read as text. Counting declarations from inside the suite
// itself is not possible, so they are counted from the source.
const fichiersDEpreuve = Object.values(
  import.meta.glob('./**/*.test.ts', { eager: true, query: '?raw', import: 'default' }),
) as string[]

// A badge shows a number and nobody rereads it. The one in this repository said
// "13 tools" and "1 dependency": if either changes without the badge following,
// the README lies on its first line, where it is believed most. These tests tie
// each badge to what it claims.
const paquet = JSON.parse(paquetBrut) as {
  dependencies: Record<string, string>
  scripts: Record<string, string>
}

const badge = (libelle: string) =>
  new RegExp(`img\\.shields\\.io/badge/${libelle}-([^-]+)-`).exec(readme)?.[1]

describe('the README badges', () => {
  it('announces the true number of WebMCP tools', () => {
    expect(badge('WebMCP%20tools')).toBe(String(ALL_TOOLS.length))
  })

  it('announces the true number of runtime dependencies', () => {
    // This is a product claim, not a statistic: "zero dependencies except idb"
    // comes back in the README, the documentation and the audits.
    expect(Object.keys(paquet.dependencies)).toEqual(['idb'])
    expect(badge('runtime%20dependencies')).toBe('1')
  })

  it('announces a count the suite can actually reach', () => {
    // The first version of this only checked the number was under twenty
    // thousand, which is true of any badge and caught nothing: it sat at 918
    // while the suite ran 928. The count is compared against the `it(`
    // declarations instead. Every declaration is at least one test, and
    // `it.each` turns one into several, so the badge belongs in that band. Add
    // tests without touching the badge and the lower bound eventually fails.
    const annonce = Number(badge('tests'))
    const declarations = fichiersDEpreuve.reduce(
      (n, t) => n + (t.match(/\bit(?:\.\w+)?\s*\(/g) ?? []).length,
      0,
    )
    expect(declarations).toBeGreaterThan(0)
    expect(annonce).toBeGreaterThanOrEqual(declarations)
    expect(annonce).toBeLessThanOrEqual(Math.round(declarations * 1.3))
  })

  it('points the CI badge at a workflow that exists', () => {
    const path = /actions\/workflows\/([\w.-]+)\/badge\.svg/.exec(readme)?.[1]
    expect(path).toBe('ci.yml')
  })

  it('posts a CI badge only if CI really runs `check`', () => {
    // The workflow spelled out its steps and had drifted: it ran `vite build`
    // bare, so without the artifact guard or the link checker that `check` had
    // ended up holding. A green badge over a check weaker than the local
    // command is worse than no badge at all.
    expect(ci).toContain('npm run check')
    expect(ci).not.toMatch(/run:\s*(npx )?vite build\s*$/m)
  })

  it('reproduces the notice of every dependency that reaches the browser', async () => {
    // ISC and MIT ask that their copyright notice travel with the distributed
    // code. `idb` is compiled INTO the file served: the notice has to live in
    // the repository, not only in node_modules.
    const notices = (await import('../THIRD-PARTY-NOTICES.md?raw')).default
    for (const nom of Object.keys(paquet.dependencies)) {
      expect(notices, nom).toContain(nom)
    }
    expect(notices).toContain('Copyright (c) 2016, Jake Archibald')
  })

  it('promises the MIT license only if the file carries it', async () => {
    const licence = (await import('../LICENSE?raw')).default
    expect(badge('license')).toBe('MIT')
    expect(licence).toContain('MIT License')
  })
})
