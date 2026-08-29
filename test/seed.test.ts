import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { renderTaskState } from '../src/domain/render'
import {
  acceptedRejections,
  activeConstraints,
  evidenceCounts,
  proposedRejections,
} from '../src/domain/task'

describe('the demo log', () => {
  it('carries three constraints in force and two ruled-out approaches', () => {
    const task = buildDemoTask()
    expect(activeConstraints(task)).toHaveLength(3)
    expect(acceptedRejections(task)).toHaveLength(2)
  })

  it('leaves one agent proposal pending, without it forbidding anything', () => {
    const task = buildDemoTask()
    const pendingRejections = proposedRejections(task)
    expect(pendingRejections).toHaveLength(1)
    expect(pendingRejections[0].source).toBe('agent')

    const output = renderTaskState(task)
    expect(output).toContain('PROPOSED BY AN AGENT: NOT binding')
    expect(output).toContain(pendingRejections[0].approach)
    const recordedRejections = output.slice(
      output.indexOf('REJECTED'),
      output.indexOf('PROPOSED BY'),
    )
    expect(recordedRejections).not.toContain(pendingRejections[0].approach)
  })

  it('separates the human constraints from the agent ones', () => {
    const task = buildDemoTask()
    const sources = activeConstraints(task).map((c) => c.source)
    expect(sources.filter((s) => s === 'human')).toHaveLength(2)
    expect(sources.filter((s) => s === 'agent')).toHaveLength(1)
    expect(activeConstraints(task).every((c) => c.standing === 'accepted')).toBe(true)
  })

  it('proposes approach C as the next action', () => {
    expect(buildDemoTask().next).toContain('approach C')
  })

  it('covers all three levels of evidence', () => {
    const counts = evidenceCounts(buildDemoTask())
    expect(counts.human_verified).toBeGreaterThan(0)
    expect(counts.evidence).toBeGreaterThan(0)
    expect(counts.claimed).toBeGreaterThan(0)
  })

  it('renders what an agent has to read to resume', () => {
    const output = renderTaskState(buildDemoTask())
    expect(output).toContain('Never modify the database schema')
    expect(output).toContain('Do not add any new dependency')
    expect(output).toContain('JWT approach B')
    expect(output).toContain('Partial index on sessions')
    expect(output).toContain('approach C')
  })

  it('does not contradict what it claims: the diff really touches two files', () => {
    const task = buildDemoTask()
    const step = task.steps.find((s) => s.result.includes('2 files touched'))
    expect(step).toBeDefined()

    const files = (step!.evidence!.content.match(/^\+\+\+ /gm) ?? []).length
    expect(files).toBe(2)
  })

  it('does not contradict the constraints it carries: the exported signature is intact', () => {
    const task = buildDemoTask()
    const step = task.steps.find((s) => s.result.includes('public API unchanged'))
    const diff = step!.evidence!.content

    const removedExports = diff.split('\n').filter((l) => /^-\s*export /.test(l))
    expect(removedExports).toEqual([])
  })

  it('is reproducible: two builds give the same shape', () => {
    const a = buildDemoTask()
    const b = buildDemoTask()
    expect(b.version).toBe(a.version)
    expect(b.constraints.map((c) => c.rule)).toEqual(a.constraints.map((c) => c.rule))
    expect(b.rejected.map((r) => r.approach)).toEqual(a.rejected.map((r) => r.approach))
    expect(b.steps.map((s) => s.confidence)).toEqual(a.steps.map((s) => s.confidence))
  })
})
