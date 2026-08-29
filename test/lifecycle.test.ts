import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/domain/errors'
import { completeTask, createTask, logStep, reopenTask, verifyEvidence } from '../src/domain/task'
import { renderNoTask, renderTaskState } from '../src/domain/render'
import type { TaskState } from '../src/domain/types'

function ctx(seed = 0) {
  let n = seed
  return { now: 1_700_000_000_000, newId: () => `id-${n++}` }
}

function close(): TaskState {
  let t = createTask({ title: 'Refactor', next: 'Map the system' }, ctx())
  t = logStep(
    t,
    {
      action: 'Suite de tests',
      result: '183 passed',
      evidence: { kind: 'test_report', content: '183 passed' },
      basedOnVersion: t.version,
    },
    'agent',
    ctx(10),
  )
  return completeTask(
    t,
    { summary: 'Refactoring complete.', basedOnVersion: t.version },
    'agent',
    ctx(20),
  )
}

describe('closing and reopening', () => {
  it('warns the agent the task is closed rather than let it fail', () => {
    const output = renderTaskState(close())
    expect(output).toContain('TASK CLOSED')
    expect(output).toContain('Writes are refused')
    expect(output).not.toContain('WRITE PROTOCOL')
    expect(output).toContain('SUMMARY')
  })

  it('lets the human reopen what the agent closed', () => {
    const closed = close()
    expect(closed.status).toBe('completed')

    const reopened = reopenTask(closed, 'The refresh flow still needs work', ctx(30))

    expect(reopened.status).toBe('active')
    expect(reopened.next).toBe('The refresh flow still needs work')
    expect(reopened.version).toBe(closed.version + 1)
    expect(reopened.audit.at(-1)).toMatchObject({ operation: 'reopen_task', actor: 'human' })
  })

  it('keeps the closing summary: it is a trace, not a lie to erase', () => {
    const closed = close()
    const reopened = reopenTask(closed, 'Work remains', ctx(30))
    expect(reopened.summary).toBe('Refactoring complete.')
  })

  it('requires a reason to reopen', () => {
    expect(() => reopenTask(close(), '  ', ctx(30))).toThrow(ValidationError)
  })

  it('refuses to reopen a task that is already active', () => {
    const active = createTask({ title: 'T' }, ctx())
    expect(() => reopenTask(active, 'pattern', ctx(10))).toThrow(ValidationError)
  })

  it('makes writes possible again after reopening', () => {
    let t = reopenTask(close(), 'Work remains', ctx(30))
    t = logStep(t, { action: 'Reprise', result: 'ok', basedOnVersion: t.version }, 'agent', ctx(40))
    expect(t.steps).toHaveLength(2)
    expect(renderTaskState(t)).toContain('WRITE PROTOCOL')
  })

  it('still lets evidence be verified after closing', () => {
    const closed = close()
    const verified = verifyEvidence(closed, closed.steps[0].id, '183 passed', ctx(30))
    expect(verified.steps[0].confidence).toBe('human_verified')
  })

  it('says plainly there is nothing to resume, without misleading advice', () => {
    const output = renderNoTask()
    expect(output).toContain('NO ACTIVE TASK')
    expect(output).toContain('nothing to resume')
    expect(output).not.toContain('call\nlog_step')
    expect(output).toContain('call resume_task again')
  })
})
