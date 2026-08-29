import { beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask as buildDemoTask } from '../src/demo/seed'
import {
  decideApproval,
  decidedApprovals,
  pendingApprovals,
  requestApproval,
} from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { renderDetail } from '../src/domain/detail'
import { renderChanges } from '../src/domain/changes'
import { searchTask } from '../src/domain/search'
import { ValidationError } from '../src/domain/errors'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

function asked(): TaskState {
  return requestApproval(
    task,
    {
      action: 'Run the migration against the staging replica',
      why: 'It rewrites 40k rows and I cannot undo it from here.',
      basedOnVersion: null,
    },
    'agent',
  )
}

describe('asking permission to act', () => {
  it('opens a request nobody has decided yet', () => {
    const next = asked()
    expect(pendingApprovals(next)).toHaveLength(1)
    expect(decidedApprovals(next)).toHaveLength(0)
    expect(pendingApprovals(next)[0]).toMatchObject({
      action: 'Run the migration against the staging replica',
      source: 'agent',
      decision: null,
    })
    expect(next.audit.at(-1)).toMatchObject({ operation: 'request_approval', actor: 'agent' })
  })

  it('requires saying what will be done and why it has to be asked', () => {
    expect(() =>
      requestApproval(task, { action: 'Do it', why: '', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
    expect(() =>
      requestApproval(task, { action: '', why: 'because', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('is decided by a human, and the decision is kept', () => {
    const next = asked()
    const id = pendingApprovals(next)[0].id

    const allowed = decideApproval(next, id, 'allowed')
    expect(pendingApprovals(allowed)).toHaveLength(0)
    expect(decidedApprovals(allowed)[0].decision).toBe('allowed')
    expect(decidedApprovals(allowed)[0].decidedAt).toBeTypeOf('number')
    expect(allowed.audit.at(-1)).toMatchObject({ operation: 'allow_action', actor: 'human' })
  })

  it('records a refusal as a refusal, not as an absence of answer', () => {
    const next = asked()
    const denied = decideApproval(next, pendingApprovals(next)[0].id, 'denied')
    expect(decidedApprovals(denied)[0].decision).toBe('denied')
    expect(denied.audit.at(-1)).toMatchObject({ operation: 'deny_action' })
  })

  it('refuses to decide twice rather than overwrite the first decision', () => {
    const next = asked()
    const id = pendingApprovals(next)[0].id
    const once = decideApproval(next, id, 'allowed')
    expect(() => decideApproval(once, id, 'denied')).toThrow(ValidationError)
  })

  it('refuses to decide a request that does not exist', () => {
    expect(() => decideApproval(task, 'nope', 'allowed')).toThrow(ValidationError)
  })

  it('refuses a request on a closed task', () => {
    const closed = { ...task, status: 'completed' as const }
    expect(() =>
      requestApproval(closed, { action: 'a', why: 'b', basedOnVersion: null }, 'agent'),
    ).toThrow()
  })
})

describe('what the other surfaces say about it', () => {
  it('puts a waiting request at the very top of what the agent reads', () => {
    const rendered = renderTaskState(asked())
    expect(rendered).toContain('AWAITING YOUR APPROVAL')
    expect(rendered).toContain('Run the migration against the staging replica')
    expect(rendered.indexOf('AWAITING YOUR APPROVAL')).toBeLessThan(rendered.indexOf('CONSTRAINTS'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('renders the human decision, which is what the agent must respect', () => {
    const next = asked()
    const denied = decideApproval(next, pendingApprovals(next)[0].id, 'denied')
    const rendered = renderTaskState(denied)
    expect(rendered).toContain('DENIED')
    expect(rendered).toContain('Run the migration')
  })

  it('invents no section when nothing has been asked', () => {
    const rendered = renderTaskState(task)
    expect(rendered).not.toContain('AWAITING YOUR APPROVAL')
  })

  it('reads back in full through read_task_detail', () => {
    const rendered = renderDetail(asked(), {
      section: 'approvals',
      offset: 0,
      limit: 5,
      id: null,
    })
    expect(rendered).toContain('SECTION     approvals')
    expect(rendered).toContain('standing: waiting')
    expect(rendered).toContain('It rewrites 40k rows')
  })

  it('counts as a change that binds you', () => {
    const next = asked()
    const allowed = decideApproval(next, pendingApprovals(next)[0].id, 'allowed')
    const rendered = renderChanges(allowed, next.version)
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).not.toContain('allow_action')
  })

  it('is found again by search', () => {
    const hits = searchTask(asked(), 'migration')
    expect(hits.some((h) => h.kind === 'approval')).toBe(true)
  })
})
