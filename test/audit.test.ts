import { describe, expect, it } from 'vitest'
import { addConstraint, createTask, logStep, recordRefusal } from '../src/domain/task'
import { MAX_AUDIT_ENTRIES } from '../src/domain/types'
import type { TaskState } from '../src/domain/types'

function ctx(seed = 0) {
  let n = seed
  return { now: 1_700_000_000_000, newId: () => `id-${n++}` }
}

function tâche(): TaskState {
  return createTask({ title: 'Tâche', next: 'Continuer' }, ctx())
}

const refus = (état: TaskState, version: number | null, décalage = 0) =>
  recordRefusal(
    état,
    { operation: 'log_step', actor: 'agent', basedOnVersion: version, detail: 'stale' },
    ctx(1000 + décalage),
  )

describe('journal d’audit', () => {
  it('compte une tentative répétée à l’identique au lieu de l’empiler', () => {
    let t = tâche()
    const avant = t.audit.length

    for (let i = 0; i < 5; i++) t = refus(t, 1, i)

    expect(t.audit).toHaveLength(avant + 1)
    expect(t.audit.at(-1)).toMatchObject({ outcome: 'refused', repeated: 5 })
  })

  it('n’assimile pas deux refus qui diffèrent', () => {
    let t = tâche()
    const avant = t.audit.length

    t = refus(t, 1, 0)
    t = refus(t, 2, 1)

    expect(t.audit).toHaveLength(avant + 2)
    expect(t.audit.at(-1)?.repeated).toBeUndefined()
  })

  it('ne fusionne jamais une réussite avec ce qui la précède', () => {
    let t = tâche()
    // Two DIFFERENT rules: a word-for-word repeat has been refused ever since
    // a guard exists, and this case is about merging entries, not about
    // duplicates.
    t = addConstraint(t, { rule: 'R one', basedOnVersion: 1 }, 'human', ctx(10))
    t = addConstraint(t, { rule: 'R two', basedOnVersion: 2 }, 'human', ctx(20))

    const appliquées = t.audit.filter((e) => e.outcome === 'applied')
    expect(appliquées).toHaveLength(3)
  })

  it('borne le journal et dit combien a été élagué', () => {
    let t = tâche()
    let v = t.version

    for (let i = 0; i < MAX_AUDIT_ENTRIES + 40; i++) {
      t = logStep(
        t,
        { action: `étape ${i}`, result: 'r', basedOnVersion: v },
        'agent',
        ctx(2000 + i),
      )
      v = t.version
    }

    expect(t.audit.length).toBeLessThanOrEqual(MAX_AUDIT_ENTRIES)

    const marque = t.audit.find((e) => e.operation === 'audit_trimmed')
    expect(marque).toBeDefined()
    expect(marque!.detail).toMatch(/^\d+ earlier entries dropped/)

    const élaguées = Number(marque!.detail.match(/^(\d+)/)![1])
    const conservées = t.audit.filter((e) => e.operation !== 'audit_trimmed').length
    expect(élaguées + conservées).toBe(MAX_AUDIT_ENTRIES + 40 + 1)
  })

  it('le contenu du cahier survit à l’élagage du journal', () => {
    let t = tâche()
    let v = t.version
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 10; i++) {
      t = logStep(
        t,
        { action: `étape ${i}`, result: 'r', basedOnVersion: v },
        'agent',
        ctx(3000 + i),
      )
      v = t.version
    }

    expect(t.steps).toHaveLength(MAX_AUDIT_ENTRIES + 10)
    expect(t.version).toBe(MAX_AUDIT_ENTRIES + 11)
  })
})
