import { describe, expect, it } from 'vitest'
import readme from '../README.md?raw'
import rawPackage from '../package.json?raw'
import ci from '../.github/workflows/ci.yml?raw'
import { ALL_TOOLS } from '../src/webmcp/tools'

// Every test file read as text. Counting declarations from inside the suite
// itself is not possible, so they are counted from the source.
const fichiersDEpreuve = Object.values(
  import.meta.glob('./**/*.test.ts', { eager: true, query: '?raw', import: 'default' }),
) as string[]

// A badge shows a number and nobody rereads it. These say "13 tools" and "1
// dependency": if either changes without the badge following, the README is
// wrong on its first line. Each badge is tied here to what it claims.
const bundle = JSON.parse(rawPackage) as {
  dependencies: Record<string, string>
  scripts: Record<string, string>
}

const badge = (label: string) =>
  new RegExp(`img\\.shields\\.io/badge/${label}-([^-]+)-`).exec(readme)?.[1]

describe('the README badges', () => {
  it('announces the true number of WebMCP tools', () => {
    expect(badge('WebMCP%20tools')).toBe(String(ALL_TOOLS.length))
  })

  it('announces the true number of runtime dependencies', () => {
    // This is a product claim, not a statistic: "zero dependencies except idb"
    // comes back in the README, the documentation and the audits.
    expect(Object.keys(bundle.dependencies)).toEqual(['idb'])
    expect(badge('runtime%20dependencies')).toBe('1')
  })

  it('announces a count the suite can actually reach', () => {
    // The first version only checked the number was under twenty thousand, true
    // of any badge: it sat at 918 while the suite ran 928. Compared against the
    // `it(` declarations instead. Each is at least one test and `it.each` turns
    // one into several, so the badge belongs in that band.
    const announce = Number(badge('tests'))
    const declarations = fichiersDEpreuve.reduce(
      (n, t) => n + (t.match(/\bit(?:\.\w+)?\s*\(/g) ?? []).length,
      0,
    )
    expect(declarations).toBeGreaterThan(0)
    expect(announce).toBeGreaterThanOrEqual(declarations)
    expect(announce).toBeLessThanOrEqual(Math.round(declarations * 1.3))
  })

  it('points the CI badge at a workflow that exists', () => {
    const path = /actions\/workflows\/([\w.-]+)\/badge\.svg/.exec(readme)?.[1]
    expect(path).toBe('ci.yml')
  })

  it('posts a CI badge only if CI really runs `check`', () => {
    // The workflow spelled out its steps and had drifted: bare `vite build`,
    // without the artifact guard or the link checker `check` had picked up. A
    // green badge over a weaker check than the local command is worse than
    // none.
    expect(ci).toContain('npm run check')
    expect(ci).not.toMatch(/run:\s*(npx )?vite build\s*$/m)
  })

  it('reproduces the notice of every dependency that reaches the browser', async () => {
    // ISC and MIT ask that their copyright notice travel with the distributed
    // code. `idb` is compiled into the file served: the notice has to live in
    // the repository, not only in node_modules.
    const notices = (await import('../THIRD-PARTY-NOTICES.md?raw')).default
    for (const name of Object.keys(bundle.dependencies)) {
      expect(notices, name).toContain(name)
    }
    expect(notices).toContain('Copyright (c) 2016, Jake Archibald')
  })

  it('promises the MIT license only if the file carries it', async () => {
    const licence = (await import('../LICENSE?raw')).default
    expect(badge('license')).toBe('MIT')
    expect(licence).toContain('MIT License')
  })
})
