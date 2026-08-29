import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask as buildDemoTask } from '../src/demo/seed'
import {
  disputeStep,
  disputedSteps,
  evidenceCounts,
  provenStepCount,
  undoLastSupervision,
  undoable,
  verifyEvidence,
} from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { renderDetail } from '../src/domain/detail'
import { renderChanges } from '../src/domain/changes'
import { searchTask } from '../src/domain/search'
import { describeEntry } from '../src/ui/history'
import { ValidationError } from '../src/domain/errors'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

const claimed = (s: TaskState) => s.steps.find((x) => x.confidence === 'claimed')!

function disputed(): TaskState {
  return disputeStep(
    task,
    claimed(task).id,
    'The prototype was never deployed, so nothing could have been measured.',
  )
}

describe('disputing a step', () => {
  it('marks the step, with the reason the human gave', () => {
    const next = disputed()
    const step = next.steps.find((s) => s.id === claimed(task).id)!

    expect(step.confidence).toBe('disputed')
    expect(step.dispute!.reason).toContain('never deployed')
    expect(step.dispute!.at).toBeTypeOf('number')
    expect(disputedSteps(next)).toHaveLength(1)
    expect(next.audit.at(-1)).toMatchObject({ operation: 'dispute_step', actor: 'human' })
  })

  it('requires a reason: "that is wrong" on its own helps nobody', () => {
    expect(() => disputeStep(task, claimed(task).id, '   ')).toThrow(ValidationError)
  })

  it('refuses an unknown step', () => {
    expect(() => disputeStep(task, 'nope', 'a reason')).toThrow(ValidationError)
  })

  it('refuses to dispute twice', () => {
    const once = disputed()
    expect(() => disputeStep(once, claimed(task).id, 'again')).toThrow(ValidationError)
  })

  it('disputes even a step you approved yourself', () => {
    const step = task.steps.find((s) => s.evidence !== null)!
    const verified = verifyEvidence(task, step.id, step.evidence!.content)
    expect(verified.steps.find((s) => s.id === step.id)!.confidence).toBe('human_verified')

    // You can have been wrong in approving: that is precisely what has to be
    // correctable.
    const next = disputeStep(verified, step.id, 'I read the wrong run.')
    expect(next.steps.find((s) => s.id === step.id)!.confidence).toBe('disputed')
  })

  it('stops counting a disputed step as proven', () => {
    const withEvidence = task.steps.find((s) => s.confidence === 'evidence')!
    const before = provenStepCount(task)
    const next = disputeStep(task, withEvidence.id, 'The output came from another branch.')

    expect(provenStepCount(next)).toBe(before - 1)
    expect(evidenceCounts(next).disputed).toBe(1)
  })

  it('undoes, and the step regains exactly the level it had', () => {
    const withEvidence = task.steps.find((s) => s.confidence === 'evidence')!
    const next = disputeStep(task, withEvidence.id, 'Wrong branch.')
    expect(undoable(next)).toContain('disputed')

    const back = undoLastSupervision(next)
    const step = back.steps.find((s) => s.id === withEvidence.id)!
    expect(step.confidence).toBe('evidence')
    expect(step.dispute).toBeNull()
  })

  it('returns a step with no evidence to `claimed` when undone', () => {
    const back = undoLastSupervision(disputed())
    expect(back.steps.find((s) => s.id === claimed(task).id)!.confidence).toBe('claimed')
  })
})

describe('what the other surfaces say about it', () => {
  it('puts the dispute at the top of what the agent reads, with its reason', () => {
    const rendered = renderTaskState(disputed())
    expect(rendered).toContain('DISPUTED BY THE HUMAN')
    expect(rendered).toContain('never deployed')
    expect(rendered.indexOf('DISPUTED BY THE HUMAN')).toBeLessThan(rendered.indexOf('RECENT WORK'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('invents nothing when nothing is disputed', () => {
    expect(renderTaskState(task)).not.toContain('DISPUTED BY THE HUMAN')
  })

  it('carries the reason into the step detail', () => {
    const rendered = renderDetail(disputed(), {
      section: 'steps',
      offset: 0,
      limit: 20,
      id: null,
    })
    expect(rendered).toContain('disputed')
    expect(rendered).toContain('never deployed')
  })

  it('counts as a change that binds the agent', () => {
    const rendered = renderChanges(disputed(), task.version)
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).not.toContain('dispute_step')
  })

  it('is found by search, through the reason', () => {
    const hits = searchTask(disputed(), 'never deployed')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('reads as a sentence in the history', () => {
    const line = describeEntry({
      id: 'e1',
      operation: 'dispute_step',
      actor: 'human',
      versionBefore: 4,
      versionAfter: 5,
      basedOnVersion: null,
      outcome: 'applied',
      detail: 'Reduced token TTL',
      at: 1,
    })
    expect(line.what).not.toContain('dispute_step')
    expect(line.what).toContain('disputed')
  })
})

describe('disputing from the page', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function written(before: number) {
    await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'l’écriture')
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('offers to dispute every step you have not approved', () => {
    const id = claimed(store.currentTask()!).id
    expect(root.querySelector(`[data-dispute="${id}"]`)).not.toBeNull()
  })

  it('asks for a reason, and refuses to dispute without one', async () => {
    const id = claimed(store.currentTask()!).id
    root.querySelector<HTMLButtonElement>(`[data-dispute="${id}"]`)!.click()
    __renderNow()

    const field = root.querySelector<HTMLTextAreaElement>('#dispute-reason')!
    expect(field).not.toBeNull()
    field.value = '   '
    field.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#form-dispute')!.requestSubmit()
    await settled()

    expect(disputedSteps(store.currentTask()!)).toHaveLength(0)
  })

  it('offers both outcomes where the evidence is in front of you', async () => {
    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Evidence to review'),
    )!
    expect(card).toBeDefined()

    // Reading evidence and only being able to approve it is a form with a
    // single outcome: refusal must sit where approval sits.
    expect(card.querySelector('[data-verify]')).not.toBeNull()
    expect(card.querySelector('[data-dispute]')).not.toBeNull()
  })

  it('drops evidence already ruled on from the review', async () => {
    const step = store.currentTask()!.steps.find((s) => s.confidence === 'evidence')!
    const before = store.currentTask()!.version
    await store.mutate((s) => disputeStep(s, step.id, 'The output came from another branch.'))
    await written(before)

    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Evidence to review'),
    )
    expect(card?.querySelector(`[data-verify="${step.id}"]`) ?? null).toBeNull()
  })

  it('marks the step, and the reason is on screen', async () => {
    const id = claimed(store.currentTask()!).id
    root.querySelector<HTMLButtonElement>(`[data-dispute="${id}"]`)!.click()
    __renderNow()

    const before = store.currentTask()!.version
    const field = root.querySelector<HTMLTextAreaElement>('#dispute-reason')!
    field.value = 'The prototype was never deployed.'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#form-dispute')!.requestSubmit()
    await written(before)

    expect(disputedSteps(store.currentTask()!)).toHaveLength(1)
    expect(root.textContent).toContain('The prototype was never deployed.')
  })
})
