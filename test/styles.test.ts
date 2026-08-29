import { describe, expect, it } from 'vitest'
import benchSource from '../src/ui/bench.ts?raw'

/*
 * Toutes les feuilles du produit, pas seulement `style.css`.
 *
 * Ce garde-fou a été écrit quand `style.css` était la seule feuille. Depuis,
 * la landing publique et l'espace de travail privé ont chacune la leur, et le
 * glob d'origine ne les relisait pas : une classe correctement stylée dans
 * `marketing.css` y était comptée comme non stylée, ce qui poussait à
 * contourner le test plutôt qu'à le satisfaire. Élargir le glob rend au
 * garde-fou sa portée réelle — il couvre maintenant tout ce que `main.ts`
 * charge, donc plus rien ne peut être livré sans style en passant entre les
 * feuilles.
 */
const css = Object.values(
  import.meta.glob('../src/*.css', { eager: true, query: '?raw', import: 'default' }),
).join('\n')

/**
 * Chaque classe de structure que la vue émet doit exister dans la feuille.
 *
 * Trois sections ont été livrées SANS AUCUN STYLE — sélecteur de tâches,
 * historique, recherche — parce que les insertions s'ancraient sur des
 * commentaires supprimés entre-temps et échouaient en silence. Rien ne l'a
 * signalé : les cas de vue cherchent du texte et des identifiants, jamais une
 * règle CSS, et le rendu restait passable grâce aux styles de base.
 */
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
