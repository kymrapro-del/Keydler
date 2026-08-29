import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { activeConstraints, copyRulesInto, createTask } from '../src/domain/task'
import { sinceThen } from '../src/domain/elapsed'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('telling elapsed time', () => {
  const now = 1_700_000_000_000

  it('stays vague to the minute, without false precision', () => {
    expect(sinceThen(now - 5_000, now)).toBe('just now')
    expect(sinceThen(now - 90_000, now)).toBe('1 minute ago')
    expect(sinceThen(now - 40 * MINUTE, now)).toBe('40 minutes ago')
  })

  it('moves up to hours, then to days', () => {
    expect(sinceThen(now - 2 * HOUR, now)).toBe('2 hours ago')
    expect(sinceThen(now - 25 * HOUR, now)).toBe('1 day ago')
    expect(sinceThen(now - 9 * DAY, now)).toBe('9 days ago')
  })

  it('claims nothing about a date in the future', () => {
    expect(sinceThen(now + HOUR, now)).toBe('just now')
  })

  it('claims nothing about an unreadable timestamp', () => {
    expect(sinceThen(Number.NaN, now)).toBeNull()
    expect(sinceThen(0, now)).toBeNull()
  })
})

describe('what the agent reads about time', () => {
  it('flags a log left unwritten for a long time', () => {
    const vieux = { ...buildCoreTask(), updatedAt: Date.now() - 30 * DAY }
    const rendered = renderTaskState(vieux)

    expect(rendered).toMatch(/LAST WRITE\s+30 days ago/)
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('stays quiet when the log has just been touched', () => {
    const frais = { ...buildCoreTask(), updatedAt: Date.now() - MINUTE }
    expect(renderTaskState(frais)).not.toContain('LAST WRITE')
  })

  it('stays quiet when the timestamp is unreadable', () => {
    const broken = { ...buildCoreTask(), updatedAt: 0 }
    expect(renderTaskState(broken)).not.toContain('LAST WRITE')
  })
})

describe('carrying rules over from a log', () => {
  it('copies the rules in force, and nothing else', () => {
    const source = buildCoreTask()
    const cible = copyRulesInto(createTask({ title: 'New task' }), source)

    const expected = activeConstraints(source).map((c) => c.rule)
    expect(activeConstraints(cible).map((c) => c.rule)).toEqual(expected)

    // Not the work, not the rejections, not the other one's write log.
    expect(cible.steps).toHaveLength(0)
    expect(cible.rejected).toHaveLength(0)
    expect(cible.decisions).toHaveLength(0)
    expect(cible.questions).toHaveLength(0)
  })

  it('makes them binding at once, and attributed to the human', () => {
    const cible = copyRulesInto(createTask({ title: 'New task' }), buildCoreTask())
    for (const rule of cible.constraints) {
      expect(rule.standing, rule.rule).toBe('accepted')
      expect(rule.source, rule.rule).toBe('human')
      expect(rule.active, rule.rule).toBe(true)
    }
  })

  it('leaves a trace of where they came from in the audit log', () => {
    const source = buildCoreTask()
    const cible = copyRulesInto(createTask({ title: 'New task' }), source)
    const entry = cible.audit.at(-1)!
    expect(entry.operation).toBe('copy_rules')
    expect(entry.detail).toContain(source.title)
  })

  it('writes nothing when there is no rule to carry over', () => {
    const vide = createTask({ title: 'No rules here' })
    const cible = createTask({ title: 'New task' })
    expect(copyRulesInto(cible, vide)).toBe(cible)
  })

  it('does not copy a lifted rule', () => {
    const source = buildCoreTask()
    const lifted = source.constraints[0]
    const withLift = {
      ...source,
      constraints: source.constraints.map((c) =>
        c.id === lifted.id ? { ...c, active: false } : c,
      ),
    }
    const cible = copyRulesInto(createTask({ title: 'New' }), withLift)
    expect(cible.constraints.some((c) => c.rule === lifted.rule)).toBe(false)
  })
})

describe('from the page', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function fill(id: string, value: string) {
    const field = root.querySelector<HTMLInputElement>(`#${id}`)!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
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

  it('offers to carry the rules over when creating a task', async () => {
    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()

    const box = root.querySelector<HTMLInputElement>('#carry-rules')
    expect(box).not.toBeNull()
    expect(root.querySelector('label[for="carry-rules"]')!.textContent).toMatch(/rule/i)
  })

  it('creates the task with the rules carried over when the box is checked', async () => {
    const expected = activeConstraints(store.currentTask()!).map((c) => c.rule)

    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()

    fill('new-title', 'Second task')
    fill('new-next', 'Start it')
    const box = root.querySelector<HTMLInputElement>('#carry-rules')!
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))

    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    // Creating and carrying the rules over are two writes: wait for the second,
    // not the first.
    await waitUntil(
      () =>
        store.currentTask()?.title === 'Second task' && store.currentTask()!.constraints.length > 0,
      'les règles reprises',
      3000,
    )
    __renderNow()

    expect(activeConstraints(store.currentTask()!).map((c) => c.rule)).toEqual(expected)
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('carries none over when the box stays unchecked', async () => {
    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()

    fill('new-title', 'Plain task')
    fill('new-next', 'Start it')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await waitUntil(() => store.currentTask()?.title === 'Plain task', 'la nouvelle tâche', 3000)
    await settled()

    expect(store.currentTask()!.constraints).toHaveLength(0)
  })

  it('shows how long the log has been untouched', async () => {
    await store.updateTask(store.currentTask()!.id, (s) => ({
      ...s,
      updatedAt: Date.now() - 3 * DAY,
    }))
    await settled()

    expect(root.textContent).toContain('3 days ago')
  })
})
