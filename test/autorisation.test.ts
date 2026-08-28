import { beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
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

describe('demander l’autorisation d’agir', () => {
  it('ouvre une demande que personne n’a encore tranchée', () => {
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

  it('exige de dire ce qui sera fait et pourquoi il faut demander', () => {
    expect(() =>
      requestApproval(task, { action: 'Do it', why: '', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
    expect(() =>
      requestApproval(task, { action: '', why: 'because', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('se tranche par un humain, et la décision est conservée', () => {
    const next = asked()
    const id = pendingApprovals(next)[0].id

    const allowed = decideApproval(next, id, 'allowed')
    expect(pendingApprovals(allowed)).toHaveLength(0)
    expect(decidedApprovals(allowed)[0].decision).toBe('allowed')
    expect(decidedApprovals(allowed)[0].decidedAt).toBeTypeOf('number')
    expect(allowed.audit.at(-1)).toMatchObject({ operation: 'allow_action', actor: 'human' })
  })

  it('consigne un refus comme un refus, pas comme une absence de réponse', () => {
    const next = asked()
    const denied = decideApproval(next, pendingApprovals(next)[0].id, 'denied')
    expect(decidedApprovals(denied)[0].decision).toBe('denied')
    expect(denied.audit.at(-1)).toMatchObject({ operation: 'deny_action' })
  })

  it('refuse de trancher deux fois plutôt que d’écraser la première décision', () => {
    const next = asked()
    const id = pendingApprovals(next)[0].id
    const once = decideApproval(next, id, 'allowed')
    expect(() => decideApproval(once, id, 'denied')).toThrow(ValidationError)
  })

  it('refuse de trancher une demande qui n’existe pas', () => {
    expect(() => decideApproval(task, 'nope', 'allowed')).toThrow(ValidationError)
  })

  it('refuse une demande sur une tâche close', () => {
    const closed = { ...task, status: 'completed' as const }
    expect(() =>
      requestApproval(closed, { action: 'a', why: 'b', basedOnVersion: null }, 'agent'),
    ).toThrow()
  })
})

describe('ce que les autres surfaces en disent', () => {
  it('met une demande en attente tout en haut de ce que lit l’agent', () => {
    const rendered = renderTaskState(asked())
    expect(rendered).toContain('AWAITING YOUR APPROVAL')
    expect(rendered).toContain('Run the migration against the staging replica')
    expect(rendered.indexOf('AWAITING YOUR APPROVAL')).toBeLessThan(rendered.indexOf('CONSTRAINTS'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('rend la décision humaine, qui est ce que l’agent doit respecter', () => {
    const next = asked()
    const denied = decideApproval(next, pendingApprovals(next)[0].id, 'denied')
    const rendered = renderTaskState(denied)
    expect(rendered).toContain('DENIED')
    expect(rendered).toContain('Run the migration')
  })

  it('n’invente aucune section quand rien n’a été demandé', () => {
    const rendered = renderTaskState(task)
    expect(rendered).not.toContain('AWAITING YOUR APPROVAL')
  })

  it('se relit en entier par read_task_detail', () => {
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

  it('compte comme un changement qui vous engage', () => {
    const next = asked()
    const allowed = decideApproval(next, pendingApprovals(next)[0].id, 'allowed')
    const rendered = renderChanges(allowed, next.version)
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).not.toContain('allow_action')
  })

  it('se retrouve par la recherche', () => {
    const hits = searchTask(asked(), 'migration')
    expect(hits.some((h) => h.kind === 'approval')).toBe(true)
  })
})
