import { describe, expect, it } from 'vitest'
import benchSource from '../src/ui/bench.ts?raw'

const css = Object.values(
  import.meta.glob('../src/style.css', { eager: true, query: '?raw', import: 'default' }),
)[0] as string

// Trois sections — sélecteur de tâches, historique, recherche — ont été livrées
// SANS AUCUN STYLE : les insertions s'ancraient sur des commentaires supprimés
// entre-temps. Rien ne l'a signalé, les cas de vue cherchant du texte et des
// identifiants, jamais une règle CSS.
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

describe('la feuille de style couvre ce que la vue émet', () => {
  it.each(STRUCTURAL)('style la classe « %s »', (name) => {
    expect(css).toMatch(new RegExp(`\\.${name.replace(/[-_]/g, '[-_]')}[\\s,:{.>]`))
  })

  it('style aussi le surlignage de recherche', () => {
    expect(css).toMatch(/(^|[\s,}])mark\s*\{/)
  })

  it('ne laisse aucune classe BEM sans règle, même écrite dans une interpolation', () => {
    // `class="card${... ? ' card--waiting' : ''}"` cache le nom à l'intérieur de
    // l'expression : l'extraction par attribut ne le voit pas. Les marqueurs BEM
    // -- et __ sont sans ambiguïté, eux, où qu'ils soient écrits.
    const bem = new Set(benchSource.match(/[a-z][a-z0-9-]*(?:__|--)[a-z0-9-]+/g) ?? [])
    const missing = [...bem].filter((name) => !css.includes(`.${name}`))
    expect(missing).toEqual([])
  })

  it('ne laisse aucune classe de la vue sans règle', () => {
    // Les classes réellement écrites dans le HTML de la vue, moins celles qui
    // sont purement sémantiques ou fournies par les jetons.
    // Un attribut qui contient une interpolation était ignoré en entier, si
    // bien qu'une classe écrite juste à côté d'un `${...}` échappait au
    // garde-fou — c'est exactement comme ça que `card--waiting` est passée.
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
