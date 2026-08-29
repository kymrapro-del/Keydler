import { describe, expect, it } from 'vitest'
import benchSource from '../src/ui/bench.ts?raw'

const css = Object.values(
  import.meta.glob('../src/style.css', { eager: true, query: '?raw', import: 'default' }),
)[0] as string

// Three sections (task switcher, history, search) shipped WITH NO STYLE AT
// ALL: the insertions anchored on comments deleted in the meantime. Nothing
// flagged it, the view cases looking for text and ids, never a CSS rule.
const STRUCTURAL = [
  'switcher',
  'switcher__body',
  'handoff',
  'search',
  'events',
  'event',
  'event__when',
  'event__what',
  'event--refused',
  'notice--ok',
  'eyebrow-row',
  'page-head__title',
  'btn--quiet',
  'card--proposals',
  'card--guide',
  'row--danger',
  'row--lifted',
  'review',
  'hero__value',
  'technical__body',
]

describe('the stylesheet covers what the view emits', () => {
  it.each(STRUCTURAL)('styles the “%s” class', (name) => {
    expect(css).toMatch(new RegExp(`\\.${name.replace(/[-_]/g, '[-_]')}[\\s,:{.>]`))
  })

  it('styles the search highlight too', () => {
    expect(css).toMatch(/(^|[\s,}])mark\s*\{/)
  })

  it('leaves no BEM class without a rule, even one written inside an interpolation', () => {
    // `class="card${... ? ' card--waiting' : ''}"` hides the name inside the
    // expression: extraction by attribute does not see it. The BEM markers
    // -- and __ are unambiguous, wherever they are written.
    const bem = new Set(benchSource.match(/[a-z][a-z0-9-]*(?:__|--)[a-z0-9-]+/g) ?? [])
    const missing = [...bem].filter((name) => !css.includes(`.${name}`))
    expect(missing).toEqual([])
  })

  it('leaves no class from the view without a rule', () => {
    // The classes actually written in the view's HTML, minus the ones that are
    // purely semantic or supplied by the tokens.
    // An attribute holding an interpolation was ignored in full, so that a
    // class written right next to a `${...}` escaped the guard: that is
    // exactly how `card--waiting` got through.
    const emitted = new Set<string>()
    for (const m of benchSource.matchAll(/class="([^"]*)"/g)) {
      const litteral = m[1].replace(/\$\{[^}]*\}/g, ' ')
      for (const name of litteral.split(/\s+/)) if (name) emitted.add(name)
    }

    const known = new Set(['visually-hidden', 'mono', 'muted', 'empty', 'quote', 'chip', 'btn'])
    const missing = [...emitted].filter(
      (name) =>
        !known.has(name) &&
        !new RegExp(`\\.${name.replace(/[-_]/g, '[-_]')}[\\s,:{.>]`).test(css) &&
        !css.includes(`.${name}`),
    )

    expect(missing).toEqual([])
  })
})
