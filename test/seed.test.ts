import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { renderTaskState } from '../src/domain/render'
import {
  acceptedRejections,
  activeConstraints,
  evidenceCounts,
  proposedRejections,
} from '../src/domain/task'

describe('cahier de démonstration', () => {
  it('porte trois contraintes en vigueur et deux approches condamnées', () => {
    const task = buildDemoTask()
    expect(activeConstraints(task)).toHaveLength(3)
    expect(acceptedRejections(task)).toHaveLength(2)
  })

  it('laisse une proposition d’agent en attente, sans qu’elle interdise rien', () => {
    const task = buildDemoTask()
    const enAttente = proposedRejections(task)
    expect(enAttente).toHaveLength(1)
    expect(enAttente[0].source).toBe('agent')

    const output = renderTaskState(task)
    expect(output).toContain('PROPOSED BY AN AGENT: NOT binding')
    expect(output).toContain(enAttente[0].approach)
    const condamnations = output.slice(output.indexOf('REJECTED'), output.indexOf('PROPOSED BY'))
    expect(condamnations).not.toContain(enAttente[0].approach)
  })

  it('distingue les contraintes humaines de celles de l’agent', () => {
    const task = buildDemoTask()
    const sources = activeConstraints(task).map((c) => c.source)
    expect(sources.filter((s) => s === 'human')).toHaveLength(2)
    expect(sources.filter((s) => s === 'agent')).toHaveLength(1)
    expect(activeConstraints(task).every((c) => c.standing === 'accepted')).toBe(true)
  })

  it('propose l’approche C comme prochaine action', () => {
    expect(buildDemoTask().next).toContain('approach C')
  })

  it('représente les trois degrés de preuve', () => {
    const counts = evidenceCounts(buildDemoTask())
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
    const step = task.steps.find((s) => s.result.includes('2 files touched'))
    expect(step).toBeDefined()

    const files = (step!.evidence!.content.match(/^\+\+\+ /gm) ?? []).length
    expect(files).toBe(2)
  })

  it('ne contredit pas les contraintes qu’il porte : la signature exportée est intacte', () => {
    const task = buildDemoTask()
    const step = task.steps.find((s) => s.result.includes('public API unchanged'))
    const diff = step!.evidence!.content

    const removedExports = diff.split('\n').filter((l) => /^-\s*export /.test(l))
    expect(removedExports).toEqual([])
  })

  it('est reproductible : deux constructions donnent la même forme', () => {
    const a = buildDemoTask()
    const b = buildDemoTask()
    expect(b.version).toBe(a.version)
    expect(b.constraints.map((c) => c.rule)).toEqual(a.constraints.map((c) => c.rule))
    expect(b.rejected.map((r) => r.approach)).toEqual(a.rejected.map((r) => r.approach))
    expect(b.steps.map((s) => s.confidence)).toEqual(a.steps.map((s) => s.confidence))
  })
})
