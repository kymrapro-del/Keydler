import { describe, expect, it } from 'vitest'
import { addConstraint, createTask, logStep, recordRefusal } from '../src/domain/task'
import { MAX_AUDIT_ENTRIES } from '../src/domain/types'
import type { TaskState } from '../src/domain/types'

function ctx(seed = 0) {
  let n = seed
  return { now: 1_700_000_000_000, newId: () => `id-${n++}` }
}

function task(): TaskState {
  return createTask({ title: 'Task', next: 'Continue' }, ctx())
}

const refusal = (state: TaskState, version: number | null, offset = 0) =>
  recordRefusal(
    state,
    { operation: 'log_step', actor: 'agent', basedOnVersion: version, detail: 'stale' },
    ctx(1000 + offset),
  )

describe('the audit trail', () => {
  it('counts an attempt repeated word for word instead of stacking it', () => {
    let t = task()
    const before = t.audit.length

    for (let i = 0; i < 5; i++) t = refusal(t, 1, i)

    expect(t.audit).toHaveLength(before + 1)
    expect(t.audit.at(-1)).toMatchObject({ outcome: 'refused', repeated: 5 })
  })

  it('does not merge two refusals that differ', () => {
    let t = task()
    const before = t.audit.length

    t = refusal(t, 1, 0)
    t = refusal(t, 2, 1)

    expect(t.audit).toHaveLength(before + 2)
    expect(t.audit.at(-1)?.repeated).toBeUndefined()
  })

  it('never merges a success with what comes before it', () => {
    let t = task()
    // Two different rules: a word-for-word repeat has been refused ever since a
    // guard exists, and this case is about merging entries, not about
    // duplicates.
    t = addConstraint(t, { rule: 'R one', basedOnVersion: 1 }, 'human', ctx(10))
    t = addConstraint(t, { rule: 'R two', basedOnVersion: 2 }, 'human', ctx(20))

    const applied = t.audit.filter((e) => e.outcome === 'applied')
    expect(applied).toHaveLength(3)
  })

  it('bounds the audit trail and says how much was trimmed', () => {
    let t = task()
    let v = t.version

    for (let i = 0; i < MAX_AUDIT_ENTRIES + 40; i++) {
      t = logStep(
        t,
        { action: `step ${i}`, result: 'r', basedOnVersion: v },
        'agent',
        ctx(2000 + i),
      )
      v = t.version
    }

    expect(t.audit.length).toBeLessThanOrEqual(MAX_AUDIT_ENTRIES)

    const marque = t.audit.find((e) => e.operation === 'audit_trimmed')
    expect(marque).toBeDefined()
    expect(marque!.detail).toMatch(/^\d+ earlier entries dropped/)

    const trimmed = Number(marque!.detail.match(/^(\d+)/)![1])
    const kept = t.audit.filter((e) => e.operation !== 'audit_trimmed').length
    expect(trimmed + kept).toBe(MAX_AUDIT_ENTRIES + 40 + 1)
  })

  it('the content of the log survives the trimming of the audit trail', () => {
    let t = task()
    let v = t.version
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 10; i++) {
      t = logStep(
        t,
        { action: `step ${i}`, result: 'r', basedOnVersion: v },
        'agent',
        ctx(3000 + i),
      )
      v = t.version
    }

    expect(t.steps).toHaveLength(MAX_AUDIT_ENTRIES + 10)
    expect(t.version).toBe(MAX_AUDIT_ENTRIES + 11)
  })
})
