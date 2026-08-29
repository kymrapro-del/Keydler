import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  addConstraint,
  completeTask,
  renameTask,
  setConstraintStanding,
  setGoal,
  setNext,
  undoLastSupervision,
  undoable,
} from '../src/domain/task'
import { needsYou, summariseNeeds } from '../src/domain/attention'
import { historyOf } from '../src/domain/trail'
import { requestApprovalTool, __setApprovalTimeout } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { call, clearDatabase, currentTask, textOf, waitUntil, writeArgs } from './helpers'

describe('an approval wait while everything else moves', () => {
  beforeEach(async () => {
    __setApprovalTimeout(400)
    store.__resetStore()
    await clearDatabase()
    await store.init()
    await store.openPreparedTask(buildCoreTask())
  })

  afterEach(() => {
    __setApprovalTimeout(120_000)
    store.__resetStore()
  })

  it('claims no agreement when the task is deleted under it', async () => {
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Do it', why: 'risky' }),
    )
    await waitUntil(() => currentTask().approvals.length > 0, 'la demande')
    await store.deleteCurrentTask()

    const result = await pending
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('NO ANSWER')
    expect(textOf(result)).not.toContain('ALLOWED')
  })

  it('claims no agreement when you switch to another notebook', async () => {
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Do it', why: 'risky' }),
    )
    await waitUntil(() => currentTask().approvals.length > 0, 'la demande')
    await store.createAndOpenTask('Elsewhere', 'x')

    const result = await pending
    expect(textOf(result)).toContain('NO ANSWER')
  })
})

describe('undo chains', () => {
  it('walks back a run of corrections to one field, one at a time', () => {
    let task = buildCoreTask()
    const title = task.title
    const but = task.goal
    task = renameTask(task, 'Second name')
    task = setGoal(task, 'A first goal')
    task = setNext(task, { next: 'A different next', basedOnVersion: null })

    task = undoLastSupervision(task)
    task = undoLastSupervision(task)
    task = undoLastSupervision(task)

    expect(task.title).toBe(title)
    expect(task.goal).toBe(but)
    expect(undoable(task)).toBeNull()
  })

  it('offers nothing more once everything is given back', () => {
    let task = renameTask(buildCoreTask(), 'Second name')
    task = undoLastSupervision(task)
    expect(undoable(task)).toBeNull()
    expect(() => undoLastSupervision(task)).toThrow()
  })

  it('stops dead at an agent write', () => {
    let task = renameTask(buildCoreTask(), 'Second name')
    task = addConstraint(task, { rule: 'An agent rule', basedOnVersion: null }, 'agent')
    expect(undoable(task)).toBeNull()
  })
})

describe('bounds of the recent surfaces', () => {
  it('keeps the summary of what is waiting short, whatever the count', () => {
    let task = buildCoreTask()
    for (let i = 0; i < 200; i++) {
      task = addConstraint(task, { rule: `Proposed rule ${i}`, basedOnVersion: null }, 'agent')
    }
    const summary = summariseNeeds(needsYou(task))!
    expect(summary.length).toBeLessThan(70)
  })

  it('carries the goal through a closing, and keeps it undoable after a reopening', () => {
    const installed = setGoal(buildCoreTask(), 'Ship it')
    const clos = completeTask(installed, { summary: 'Done', basedOnVersion: null }, 'human')
    expect(clos.goal).toBe('Ship it')
    // Setting a goal on a closed task stays possible: the human stays in charge.
    expect(() => setGoal(clos, 'Another goal')).not.toThrow()
  })

  it('names the decision in the history of an accepted proposal', () => {
    const proposed = addConstraint(
      buildCoreTask(),
      { rule: 'A proposed rule', basedOnVersion: null },
      'agent',
    )
    const id = proposed.constraints.at(-1)!.id
    const accepted = setConstraintStanding(proposed, id, 'accepted')

    expect(historyOf(accepted, id).entries.map((e) => e.operation)).toEqual(['accept_constraint'])
  })
})

describe('the search filter between two notebooks', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildCoreTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('does not carry a filter from one task to the next', async () => {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = 'token'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()

    root.querySelector<HTMLButtonElement>('[data-filter="step"]')!.click()
    __renderNow()
    expect(root.querySelector('[data-filter="step"]')!.getAttribute('aria-pressed')).toBe('true')

    await store.createAndOpenTask('Elsewhere', 'x')
    await settled()

    const again = root.querySelector<HTMLInputElement>('#search')!
    again.value = 'token'
    again.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()

    // A filter inherited from another task would make a hit look like nothing.
    const all = root.querySelector('[data-filter="all"]')
    expect(all === null || all.getAttribute('aria-pressed') === 'true').toBe(true)
  })
})
