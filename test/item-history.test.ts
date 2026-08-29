import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  editConstraint,
  logStep,
  setConstraintActive,
} from '../src/domain/task'
import { MAX_AUDIT_ENTRIES } from '../src/domain/types'
import { historyOf } from '../src/domain/trail'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildCoreTask()
})

describe('following what happened to a single rule', () => {
  it('returns nothing for an unknown id', () => {
    expect(historyOf(task, 'nope').entries).toEqual([])
  })

  it('gathers everything that touched that rule, in order', () => {
    const rule = activeConstraints(task)[0]
    let next = editConstraint(task, rule.id, 'A reworded rule')
    next = setConstraintActive(next, rule.id, false)
    next = setConstraintActive(next, rule.id, true)

    const trail = historyOf(next, rule.id).entries
    expect(trail.map((e) => e.operation)).toEqual([
      'edit_constraint',
      'deactivate_constraint',
      'reactivate_constraint',
    ])
    expect(trail.map((e) => e.versionAfter)).toEqual(
      [...trail.map((e) => e.versionAfter)].sort((a, b) => a - b),
    )
  })

  it('does not mix two rules', () => {
    const [plain, secondConstraint] = activeConstraints(task)
    let next = setConstraintActive(task, plain.id, false)
    next = setConstraintActive(next, secondConstraint.id, false)

    expect(historyOf(next, plain.id).entries).toHaveLength(1)
    expect(historyOf(next, secondConstraint.id).entries).toHaveLength(1)
  })

  it('carries what was replaced, when there is something', () => {
    const rule = activeConstraints(task)[0]
    const next = editConstraint(task, rule.id, 'A reworded rule')
    expect(historyOf(next, rule.id).entries[0].previous).toBe(rule.rule)
  })

  it('does not forget a rule proposed then accepted', () => {
    const proposed = addConstraint(task, { rule: 'A proposed rule', basedOnVersion: null }, 'agent')
    const id = proposed.constraints.at(-1)!.id
    // The proposal itself has no target: it is the decision that has one.
    expect(historyOf(proposed, id).entries).toEqual([])
  })
})

describe('from the page', () => {
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
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)

    // A single task: two calls would give different ids.
    const base = buildCoreTask()
    const rule = activeConstraints(base)[0]
    await store.openPreparedTask(
      setConstraintActive(editConstraint(base, rule.id, 'A reworded rule'), rule.id, false),
    )
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('shows nothing until it is asked', () => {
    expect(root.querySelector('.trail')).toBeNull()
    expect(root.querySelector('[data-trail]')).not.toBeNull()
  })

  it('unfolds the history of that rule, in human language', async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-trail]')!
    button.click()
    __renderNow()

    const trail = root.querySelector('.trail')!
    expect(trail).not.toBeNull()
    expect(trail.textContent).toContain('reworded a rule')
    // No machine operation name on screen.
    expect(trail.textContent).not.toContain('edit_constraint')
  })

  it('folds back on the second click', async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-trail]')!
    button.click()
    __renderNow()
    expect(root.querySelector('.trail')).not.toBeNull()

    root.querySelector<HTMLButtonElement>('[data-trail]')!.click()
    __renderNow()
    expect(root.querySelector('.trail')).toBeNull()
  })

  it('opens only one history at a time', async () => {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-trail]')]
    expect(buttons.length).toBeGreaterThan(1)

    buttons[0].click()
    __renderNow()
    root.querySelectorAll<HTMLButtonElement>('[data-trail]')[1].click()
    __renderNow()

    expect(root.querySelectorAll('.trail')).toHaveLength(1)
  })

  it('follows the rule when it is lifted from the screen', async () => {
    const rules = activeConstraints(store.currentTask()!)
    const before = store.currentTask()!.version

    root.querySelector<HTMLButtonElement>(`[data-toggle="${rules[0].id}"]`)!.click()
    await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'the lift')
    __renderNow()

    root.querySelector<HTMLButtonElement>(`[data-trail="${rules[0].id}"]`)!.click()
    __renderNow()
    expect(root.querySelector('.trail')!.textContent).toContain('lifted a rule')
  })
})

describe('a pruned history says so', () => {
  function makeSaturated(): { task: TaskState; ruleId: string } {
    let next = buildCoreTask()
    const rule = activeConstraints(next)[0]
    next = setConstraintActive(next, rule.id, false)

    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      next = logStep(next, { action: `step ${i}`, result: 'x', basedOnVersion: null }, 'agent')
    }
    return { task: next, ruleId: rule.id }
  }

  it('does not claim to be complete when the log has been pruned', () => {
    const { task, ruleId } = makeSaturated()
    const trail = historyOf(task, ruleId)

    // This rule's entries fell out of the bounded audit log: saying nothing
    // would amount to claiming that nothing happened.
    expect(trail.entries).toHaveLength(0)
    expect(trail.mayBeIncomplete).toBe(true)
  })

  it('calls itself complete as long as nothing has been pruned', () => {
    const rule = activeConstraints(task)[0]
    const trail = historyOf(setConstraintActive(task, rule.id, false), rule.id)
    expect(trail.entries).toHaveLength(1)
    expect(trail.mayBeIncomplete).toBe(false)
  })

  it('warns even when there are still entries to show', () => {
    const { task: beforeState, ruleId } = makeSaturated()
    const saturated = setConstraintActive(beforeState, ruleId, true)

    const trail = historyOf(saturated, ruleId)
    expect(trail.entries.length).toBeGreaterThan(0)
    expect(trail.mayBeIncomplete).toBe(true)
  })
})

describe('the warning on screen', () => {
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
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)

    let base = buildCoreTask()
    const rule = activeConstraints(base)[0]
    base = setConstraintActive(base, rule.id, false)
    base = setConstraintActive(base, rule.id, true)
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      base = logStep(base, { action: `step ${i}`, result: 'x', basedOnVersion: null }, 'agent')
    }
    base = setConstraintActive(base, rule.id, false)

    await store.openPreparedTask(base)
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('says that older entries were dropped', () => {
    root.querySelector<HTMLButtonElement>('[data-trail]')!.click()
    __renderNow()

    const trail = root.querySelector('.trail')!
    expect(trail.textContent).toMatch(/older|dropped|earlier/i)
  })

  it('still offers the history even when everything has been pruned', async () => {
    // With no surviving entry, hiding the button would keep the pruning quiet.
    const task = store.currentTask()!
    const forgotten = task.constraints[1]
    expect(root.querySelector(`[data-trail="${forgotten.id}"]`)).not.toBeNull()

    root.querySelector<HTMLButtonElement>(`[data-trail="${forgotten.id}"]`)!.click()
    __renderNow()
    expect(root.querySelector('.trail')!.textContent).toMatch(/older|dropped|earlier/i)
  })
})
