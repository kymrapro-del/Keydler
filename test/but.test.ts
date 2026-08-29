import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  completeTask,
  createTask,
  setGoal,
  undoable,
  undoLastSupervision,
} from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { ValidationError } from '../src/domain/errors'
import { completeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { taskUrl } from '../src/webmcp/location'
import { call, clearDatabase, currentTask, textOf, waitUntil, writeArgs } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildCoreTask()
})

const BUT = 'Every session expires in under 30 minutes, with no change to the schema.'

describe('what "done" means', () => {
  it('does not exist until somebody writes it', () => {
    expect(createTask({ title: 'X' }).goal).toBeNull()
  })

  it('gets written, and stays attributed to the human', () => {
    const next = setGoal(task, BUT)
    expect(next.goal).toBe(BUT)
    expect(next.audit.at(-1)).toMatchObject({ operation: 'set_goal', actor: 'human' })
  })

  it('is removed, without that being an error', () => {
    const installed = setGoal(task, BUT)
    expect(setGoal(installed, '   ').goal).toBeNull()
  })

  it('refuses to be rewritten word for word', () => {
    const installed = setGoal(task, BUT)
    expect(() => setGoal(installed, BUT)).toThrow(ValidationError)
  })

  it('is undone like any other correction of a field', () => {
    const installed = setGoal(task, 'A first attempt')
    const changed = setGoal(installed, BUT)
    expect(undoable(changed)).toContain('what done')
    expect(undoLastSupervision(changed).goal).toBe('A first attempt')
  })
})

describe('what the agent reads of it', () => {
  it('places it with the next action, not at the bottom', () => {
    const rendered = renderTaskState(setGoal(task, BUT))
    expect(rendered).toContain('DONE WHEN')
    expect(rendered).toContain('with no change to the schema')
    expect(rendered.indexOf('DONE WHEN')).toBeLessThan(rendered.indexOf('CONSTRAINTS'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('stays silent when nobody has written it', () => {
    expect(renderTaskState(task)).not.toContain('DONE WHEN')
  })

  it('stays readable on a closed task, next to the summary', () => {
    const closed = completeTask(setGoal(task, BUT), { summary: 'S', basedOnVersion: null }, 'human')
    const rendered = renderTaskState(closed)
    expect(rendered).toContain('DONE WHEN')
    expect(rendered).toContain('SUMMARY')
  })
})

describe('closing a task that had a goal', () => {
  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
  })

  afterEach(() => store.__resetStore())

  it('reminds the agent of the goal, so its summary answers it', async () => {
    await store.openPreparedTask(setGoal(buildCoreTask(), BUT))
    const result = await call(completeTaskTool, writeArgs(currentTask(), { summary: 'Done.' }))

    expect(result.isError).toBeFalsy()
    const text = textOf(result)
    expect(text).toContain('DONE WHEN')
    expect(text).toContain(BUT)
    expect(text.toLowerCase()).toContain('say whether')
  })

  it('reminds of nothing when no goal was ever set', async () => {
    await store.openPreparedTask(buildCoreTask())
    const result = await call(completeTaskTool, writeArgs(currentTask(), { summary: 'Done.' }))
    expect(textOf(result)).not.toContain('DONE WHEN')
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

  it('invites you to say what "done" means when nothing is written', () => {
    const bouton = root.querySelector('#edit-goal')!
    expect(bouton).not.toBeNull()
    expect(bouton.textContent).toMatch(/done/i)
  })

  it('writes it, and shows it under the next action', async () => {
    root.querySelector<HTMLButtonElement>('#edit-goal')!.click()
    __renderNow()

    const field = root.querySelector<HTMLInputElement>('#edit-value')!
    field.value = BUT
    field.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()

    await waitUntil(() => store.currentTask()?.goal === BUT, 'the goal to be written', 3000)
    __renderNow()

    expect(root.querySelector('.hero')!.textContent).toContain(BUT)
  })
})

describe('for an agent without WebMCP', () => {
  let root: HTMLElement
  let unmount: () => void
  let copied: string | null

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    copied = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          copied = t
          return Promise.resolve()
        },
      },
    })
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(setGoal(buildCoreTask(), BUT))
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('copies the log as text, just as the agent would have received it', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => copied !== null, 'the copy', 3000)

    // The same text as resume_task, down to the same options: that is the whole
    // point, the agent reads exactly what the tool would have returned.
    const attendu = renderTaskState(store.currentTask()!, {
      url: taskUrl(store.currentTask()!.id),
      credentials: [],
    })
    expect(copied).toContain(attendu)
  })

  it('frames it with an instruction, so it is not an anonymous wall of text', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => copied !== null, 'the copy', 3000)

    expect(copied!.toLowerCase()).toContain('continue this task')
    expect(copied!.toLowerCase()).toContain('read this before')
  })

  it('carries no credential value', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => copied !== null, 'the copy', 3000)

    for (const mot of ['ciphertext', 'passphrase', 'sealed:']) {
      expect(copied, mot).not.toContain(mot)
    }
  })

  it('says what it just copied', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'the message', 3000)
    __renderNow()
    expect(root.querySelector('.notice--ok')!.textContent!.toLowerCase()).toContain('paste')
  })
})
