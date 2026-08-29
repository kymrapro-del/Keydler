import { describe, expect, it } from 'vitest'

// Every earlier pass worked from a list of paths written by hand: src, test,
// scripts, workers. `bench/` was never on it, so two files kept their French
// comments and their em dashes through all of them, and the miss only surfaced
// because somebody read one out loud.
//
// This walks what is actually there instead. A new directory is covered the
// day it appears, which is the only reason this file exists rather than one
// more careful list.
const SOURCES = import.meta.glob(
  '../{src,test,bench,scripts,workers,public}/**/*.{ts,mts,js,mjs}',
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
) as Record<string, string>

const RACINE = import.meta.glob('../*.{ts,js,mjs,html,json}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const TOUT = { ...SOURCES, ...RACINE }

/** Words common enough in French that two of them in one line is not an accident. */
const FRANÇAIS =
  /\b(le|la|les|des|une|est|pas|que|qui|pour|dans|avec|sans|donc|mais|plus|cela|sur|aux|par|leur|elle|nous|être|avoir|cette|sont|fait|tout|ce|se|ne)\b/gi

const commentaires = (source: string) =>
  source
    .split('\n')
    .map((l, i) => [i + 1, l.trim()] as const)
    .filter(([, l]) => l.startsWith('//') || l.startsWith('*') || l.startsWith('/*'))

describe('the repository speaks one language', () => {
  it('has no French left in a comment', () => {
    const restants = Object.entries(TOUT).flatMap(([f, source]) =>
      commentaires(source)
        .filter(([, l]) => (l.match(FRANÇAIS) ?? []).length >= 2)
        .map(([n, l]) => `${f}:${n}  ${l.slice(0, 70)}`),
    )
    expect(restants).toEqual([])
  })

  it('has no em dash anywhere, comment or code', () => {
    // They were removed everywhere on purpose: an em dash is the clearest
    // tell that a machine wrote the line. A comma, a colon or a full stop
    // does the same work.
    //
    // Two files are exempt by name, and only two: the ones whose job is to
    // look for the character have to contain it. Exempting by name rather
    // than by pattern keeps the hole exactly two files wide.
    const CHERCHENT = ['tout-en-anglais.test.ts', 'carte-sociale.test.ts']
    const restants = Object.entries(TOUT)
      .filter(([f]) => !CHERCHENT.some((x) => f.endsWith(x)))
      .flatMap(([f, source]) =>
        source
          .split('\n')
          .map((l, i) => [i + 1, l] as const)
          .filter(([, l]) => l.includes('—'))
          .map(([n, l]) => `${f}:${n}  ${l.trim().slice(0, 70)}`),
      )
    expect(restants).toEqual([])
  })

  it('found every file, not just the ones somebody remembered', () => {
    // The guard is only worth what its reach is. If this number falls, a
    // directory has dropped out of the glob and the two checks above went
    // quiet without anything being fixed.
    expect(Object.keys(TOUT).length).toBeGreaterThan(140)
    expect(Object.keys(TOUT).some((f) => f.includes('/bench/'))).toBe(true)
    expect(Object.keys(TOUT).some((f) => f.includes('/public/'))).toBe(true)
  })
})
