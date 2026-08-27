import { describe, expect, it } from 'vitest'
import benchSource from '../src/ui/bench.ts?raw'

const css = Object.values(
  import.meta.glob('../src/style.css', { eager: true, query: '?raw', import: 'default' }),
)[0] as string

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

  it('ne laisse aucune classe de la vue sans règle', () => {
    // Les classes réellement écrites dans le HTML de la vue, moins celles qui
    // sont purement sémantiques ou fournies par les jetons.
    const emitted = new Set<string>()
    for (const m of benchSource.matchAll(/class="([^"$]*)"/g)) {
      for (const name of m[1].split(/\s+/)) if (name) emitted.add(name)
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
