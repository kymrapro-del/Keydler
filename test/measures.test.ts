import { describe, expect, it } from 'vitest'
import { MEASURES, buildMeasureTask } from '../src/demo/measures'
import { renderTaskState } from '../src/domain/render'
import { activeConstraints } from '../src/domain/task'

describe('measurement notebooks', () => {
  it('counts eight of them, numbered without a gap', () => {
    expect(MEASURES).toHaveLength(8)
    expect(MEASURES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('gives each one an active rule and a condemned approach with a reason', () => {
    for (const spec of MEASURES) {
      const task = buildMeasureTask(spec.n)
      expect(activeConstraints(task)).toHaveLength(1)
      expect(task.rejected).toHaveLength(1)
      expect(task.rejected[0].approach).toBe(spec.condemned)
      expect(task.rejected[0].reason.length).toBeGreaterThan(30)
    }
  })

  it('gives the agent back the condemned approach and its reason', () => {
    for (const spec of MEASURES) {
      const output = renderTaskState(buildMeasureTask(spec.n))
      expect(output).toContain(spec.condemned)
      expect(output).toContain(spec.constraint)
      expect(output).toContain('REJECTED: do not retry')
    }
  })

  it('does not give the solution away in the next action', () => {
    for (const spec of MEASURES) {
      expect(spec.next.toLowerCase()).toContain('choose and implement')
    }
  })

  it('renders where the condemned approach came from', () => {
    const output = renderTaskState(buildMeasureTask(1))
    expect(output).toMatch(/REJECTED: do not retry\n {2}\[human\]/)
  })

  it('carries a stable id, so it does not stack one row per load', () => {
    expect(buildMeasureTask(3).id).toBe('mesure-3')
    expect(buildMeasureTask(3).id).toBe(buildMeasureTask(3).id)
  })

  it('refuses an unknown number rather than returning an empty notebook', () => {
    expect(() => buildMeasureTask(99)).toThrow(/99/)
  })
})
