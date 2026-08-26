import { describe, expect, it } from 'vitest'
import { MEASURES, buildMeasureTask } from '../src/demo/measures'
import { renderTaskState } from '../src/domain/render'
import { activeConstraints } from '../src/domain/task'

/**
 * Les cahiers de mesure sont un livrable : le protocole du J6 s'y appuie, et un
 * tiers doit pouvoir rejouer la mesure. S'ils dérivent, le chiffre publié
 * cesse d'être reproductible sans que personne s'en aperçoive.
 */
describe('cahiers de mesure', () => {
  it('en compte huit, numérotés sans trou', () => {
    expect(MEASURES).toHaveLength(8)
    expect(MEASURES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('donne à chacun une contrainte active et une approche condamnée motivée', () => {
    for (const spec of MEASURES) {
      const task = buildMeasureTask(spec.n)
      expect(activeConstraints(task)).toHaveLength(1)
      expect(task.rejected).toHaveLength(1)
      expect(task.rejected[0].approach).toBe(spec.condemned)
      // Un rejet sans motif ne sert à rien, et ici le motif EST la mesure :
      // c'est la raison locale qu'aucun modèle ne peut déduire.
      expect(task.rejected[0].reason.length).toBeGreaterThan(30)
    }
  })

  it('restitue à l’agent l’approche condamnée et son motif', () => {
    for (const spec of MEASURES) {
      const output = renderTaskState(buildMeasureTask(spec.n))
      expect(output).toContain(spec.condemned)
      expect(output).toContain(spec.constraint)
      expect(output).toContain('REJECTED — do not retry')
    }
  })

  it('ne souffle pas la solution dans la prochaine action', () => {
    for (const spec of MEASURES) {
      // Si « next » nommait le mécanisme à retenir, la mesure ne mesurerait
      // que la capacité à recopier une consigne.
      expect(spec.next.toLowerCase()).toContain('choose and implement')
    }
  })

  it('rend la provenance de l’approche condamnée', () => {
    // Sans elle, un veto humain et une conjecture d'agent se lisent pareil.
    const output = renderTaskState(buildMeasureTask(1))
    expect(output).toMatch(/REJECTED — do not retry\n {2}\[human\]/)
  })

  it('porte un identifiant stable, pour ne pas empiler une ligne par chargement', () => {
    expect(buildMeasureTask(3).id).toBe('mesure-3')
    expect(buildMeasureTask(3).id).toBe(buildMeasureTask(3).id)
  })

  it('refuse un numéro inconnu plutôt que de rendre un cahier vide', () => {
    expect(() => buildMeasureTask(99)).toThrow(/99/)
  })
})
