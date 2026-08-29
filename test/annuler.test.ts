import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  answerQuestion,
  askHuman,
  logStep,
  openQuestions,
  proposedConstraints,
  proposedRejections,
  rejectApproach,
  renameTask,
  setArchived,
  setConstraintActive,
  setConstraintStanding,
  setRejectionStanding,
  undoLastSupervision,
  undoable,
} from '../src/domain/task'
import { ValidationError } from '../src/domain/errors'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

describe('undoing the last supervision decision', () => {
  it('offers nothing when nothing is undoable', () => {
    const fresh = logStep(task, { action: 'a', result: 'b', basedOnVersion: null }, 'agent')
    expect(undoable(fresh)).toBeNull()
    expect(() => undoLastSupervision(fresh)).toThrow(ValidationError)
  })

  it('restores a rule lifted by mistake', () => {
    const rule = activeConstraints(task)[0]
    const lifted = setConstraintActive(task, rule.id, false)
    expect(activeConstraints(lifted).some((c) => c.id === rule.id)).toBe(false)

    expect(undoable(lifted)).toContain('lifted')
    const back = undoLastSupervision(lifted)
    expect(activeConstraints(back).some((c) => c.id === rule.id)).toBe(true)
    expect(back.audit.at(-1)).toMatchObject({ operation: 'undo', actor: 'human' })
  })

  it('returns a proposal accepted by mistake to the proposed state', () => {
    const proposed = addConstraint(
      task,
      { rule: 'Keep flags stable', basedOnVersion: null },
      'agent',
    )
    const id = proposedConstraints(proposed).at(-1)!.id
    const accepted = setConstraintStanding(proposed, id, 'accepted')

    const back = undoLastSupervision(accepted)
    expect(proposedConstraints(back).some((c) => c.id === id)).toBe(true)
    // A rule returned to the proposed state no longer constrains anyone.
    expect(activeConstraints(back).some((c) => c.id === id)).toBe(false)
  })

  it('returns a rejection declined by mistake to the proposed state', () => {
    const proposed = rejectApproach(
      task,
      { approach: 'Sharding by tenant', reason: 'unmeasured', basedOnVersion: null },
      'agent',
    )
    const id = proposedRejections(proposed).at(-1)!.id
    const declined = setRejectionStanding(proposed, id, 'declined')

    const back = undoLastSupervision(declined)
    expect(proposedRejections(back).some((r) => r.id === id)).toBe(true)
  })

  it('unarchives a task archived by mistake', () => {
    const archived = setArchived(task, true)
    const back = undoLastSupervision(archived)
    expect(back.archived).toBe(false)
  })

  it('erases nothing: an undo is one more write', () => {
    const rule = activeConstraints(task)[0]
    const lifted = setConstraintActive(task, rule.id, false)
    const back = undoLastSupervision(lifted)

    expect(back.version).toBe(lifted.version + 1)
    expect(back.audit.some((e) => e.operation === 'deactivate_constraint')).toBe(true)
    expect(back.audit.at(-1)!.detail).toContain(rule.rule)
  })

  it('goes back to the previous decision when you undo twice', () => {
    const rules = activeConstraints(task)
    let next = setConstraintActive(task, rules[0].id, false)
    next = setConstraintActive(next, rules[1].id, false)

    next = undoLastSupervision(next)
    expect(activeConstraints(next).some((c) => c.id === rules[1].id)).toBe(true)

    next = undoLastSupervision(next)
    expect(activeConstraints(next).some((c) => c.id === rules[0].id)).toBe(true)
    expect(undoable(next)).toBeNull()
  })

  it('ignores what an agent wrote: you undo only your own decisions', () => {
    const proposed = addConstraint(task, { rule: 'Agent rule', basedOnVersion: null }, 'agent')
    expect(undoable(proposed)).toBeNull()
  })

  it('leaves alone what is no longer in the state it was left in', () => {
    const rule = activeConstraints(task)[0]
    const lifted = setConstraintActive(task, rule.id, false)
    // The human changed their mind by hand in the meantime.
    const restored = setConstraintActive(lifted, rule.id, true)

    // The lift is no longer in force: undoing it would replay it backwards.
    expect(undoable(restored)).toContain('restored')
  })

  it('undoes neither an answer nor a logged step', () => {
    // An answer may have been read and followed by an agent: pulling it back in
    // one click would erase what it leaned on. A step is the account of a piece
    // of work, not a supervision decision.
    const asked = askHuman(
      task,
      { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
      'agent',
    )
    const answered = answerQuestion(asked, openQuestions(asked)[0].id, 'eu-west-1')
    expect(undoable(answered)).toBeNull()

    expect(
      undoable(logStep(task, { action: 'a', result: 'b', basedOnVersion: null }, 'human')),
    ).toBeNull()
  })

  it('undoes a rename, though, which is only a replaced word', () => {
    expect(undoable(renameTask(task, 'A new title'))).toContain('renamed')
  })
})

describe('undoing from the page', () => {
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

  it('shows no button while there is nothing to undo', () => {
    expect(root.querySelector('#undo')).toBeNull()
  })

  it('appears after a decision, and says which one', async () => {
    const before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await written(before)

    const undo = root.querySelector<HTMLButtonElement>('#undo')!
    expect(undo).not.toBeNull()
    expect(undo.textContent).toContain('Undo')
    expect(undo.getAttribute('aria-label')).toContain('lifted')
  })

  it('gives the decision back, and the button disappears', async () => {
    const rule = store.currentTask()!.constraints.find((c) => c.active)!
    let before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await written(before)

    before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('#undo')!.click()
    await written(before)

    expect(store.currentTask()!.constraints.find((c) => c.id === rule.id)!.active).toBe(true)
    expect(root.querySelector('#undo')).toBeNull()
  })
})
