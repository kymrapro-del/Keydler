import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { renderTaskState } from '../src/domain/render'
import { activeConstraints, evidenceCounts } from '../src/domain/task'

/**
 * Le cahier de démonstration est un livrable, pas un décor.
 *
 * La vidéo, la mesure et le README s'appuient sur son contenu. S'il dérive,
 * une affirmation publiée devient fausse sans que personne s'en aperçoive —
 * exactement ce que le contrôle avant dépôt interdit.
 */
describe('cahier de démonstration', () => {
  it('porte trois contraintes actives et deux approches rejetées', () => {
    const task = buildDemoTask()
    // Ces deux nombres sont cités dans le README : les changer sans changer le
    // texte publierait un chiffre faux.
    expect(activeConstraints(task)).toHaveLength(3)
    expect(task.rejected).toHaveLength(2)
  })

  it('distingue les contraintes humaines de celles de l’agent', () => {
    const task = buildDemoTask()
    const sources = activeConstraints(task).map((c) => c.source)
    expect(sources.filter((s) => s === 'human')).toHaveLength(2)
    expect(sources.filter((s) => s === 'agent')).toHaveLength(1)
  })

  it('propose l’approche C comme prochaine action', () => {
    expect(buildDemoTask().next).toContain('approach C')
  })

  it('représente les quatre degrés de preuve', () => {
    const counts = evidenceCounts(buildDemoTask())
    // La distinction prouvé / affirmé ne se voit que si les quatre sont là.
    // « human_verified » en particulier : sans lui, la démonstration ne
    // montrerait pas la supervision humaine.
    expect(counts.machine_verified).toBeGreaterThan(0)
    expect(counts.human_verified).toBeGreaterThan(0)
    expect(counts.evidence).toBeGreaterThan(0)
    expect(counts.claimed).toBeGreaterThan(0)
  })

  it('restitue ce qu’un agent doit lire pour reprendre', () => {
    const output = renderTaskState(buildDemoTask())
    expect(output).toContain('Never modify the database schema')
    expect(output).toContain('Do not add any new dependency')
    expect(output).toContain('JWT approach B')
    expect(output).toContain('Partial index on sessions')
    expect(output).toContain('approach C')
  })

  it('ne contredit pas ce qu’il affirme : le diff touche bien deux fichiers', () => {
    const task = buildDemoTask()
    const étape = task.steps.find((s) => s.result.includes('2 files touched'))
    expect(étape).toBeDefined()

    const fichiers = (étape!.evidence!.content.match(/^\+\+\+ /gm) ?? []).length
    expect(fichiers).toBe(2)
  })

  it('ne contredit pas les contraintes qu’il porte : la signature exportée est intacte', () => {
    const task = buildDemoTask()
    const étape = task.steps.find((s) => s.result.includes('public API unchanged'))
    const diff = étape!.evidence!.content

    // Une contrainte active interdit de toucher à l'API publique. Une ligne
    // supprimée qui exporte une fonction la violerait, preuve à l'appui.
    const exportsSupprimés = diff.split('\n').filter((l) => /^-\s*export /.test(l))
    expect(exportsSupprimés).toEqual([])
  })

  it('est reproductible : deux constructions donnent la même forme', () => {
    const a = buildDemoTask()
    const b = buildDemoTask()
    // Les identifiants et horodatages diffèrent ; la structure, non.
    expect(b.version).toBe(a.version)
    expect(b.constraints.map((c) => c.rule)).toEqual(a.constraints.map((c) => c.rule))
    expect(b.rejected.map((r) => r.approach)).toEqual(a.rejected.map((r) => r.approach))
    expect(b.steps.map((s) => s.confidence)).toEqual(a.steps.map((s) => s.confidence))
  })
})
