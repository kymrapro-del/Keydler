import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { buildFullExport, buildTaskExport } from '../src/export/notebook'
import { NothingToImportError, parseExport } from '../src/export/restore'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

let root: HTMLElement
let unmount: () => void

async function settled(turns = 6) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function waitFor(condition: () => boolean, label: string, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await settled(2)
    if (condition()) return
  }
  throw new Error(`timed out : ${label}`)
}

function button(label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`button “${label}” is missing`)
  return found
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  history.replaceState(null, '', '/')
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

describe('several logs', () => {
  it('makes the other tasks reachable from the one that is open', async () => {
    const first = await store.createAndOpenTask('First task', 'Do the first thing')
    const second = await store.createAndOpenTask('Second task', 'Do the second thing')
    await waitFor(() => root.querySelector('[data-open]') !== null, 'task list')

    // Without this switcher, the first task was reachable only by its address:
    // creating a second one made it disappear from the interface.
    const switcher = root.querySelector('.switcher')!
    expect(switcher.textContent).toContain('2 tasks on this device')
    expect(switcher.textContent).toContain('First task')
    expect(store.currentTask()!.id).toBe(second.id)

    root.querySelector<HTMLButtonElement>(`[data-open="${first.id}"]`)!.click()
    await waitFor(() => store.currentTask()?.id === first.id, 'open the first task')

    expect(store.currentTask()!.title).toBe('First task')
    expect(location.pathname).toBe(`/t/${first.id}`)
  })

  it('does not offer to open the task that is already open', async () => {
    const only = await store.createAndOpenTask('Only task', 'Do it')
    await waitFor(() => root.querySelector('.switcher') !== null, 'switcher')

    expect(root.querySelector(`[data-open="${only.id}"]`)).toBeNull()
    expect(root.querySelector('.switcher')!.textContent).toContain('This is the only one.')
  })

  it('tells a closed task from an open one in the list', async () => {
    const closed = await store.createAndOpenTask('Closed one', 'x')
    await store.mutate((s) => ({ ...s, status: 'completed' as const, next: null }))
    await store.createAndOpenTask('Open one', 'y')
    await waitFor(() => root.querySelector('[data-open]') !== null, 'liste')

    const row = root.querySelector(`[data-open="${closed.id}"]`)!.closest('.row')!
    expect(row.textContent).toContain('closed')
  })

  it('opens the creation form from an existing task', async () => {
    await store.createAndOpenTask('Existing', 'Continue')
    await waitFor(() => root.querySelector('#new-task') !== null, 'button')

    button('New task').click()
    await settled()

    // The form lived only in the home screen: from a dashboard, "New task"
    // showed nothing at all.
    expect(root.querySelector('#create-task')).not.toBeNull()
    expect(document.activeElement?.id).toBe('new-title')
  })
})

describe('reading an export back', () => {
  it('finds a log in a single-task export', () => {
    const task = buildDemoTask()
    const [read] = parseExport(buildTaskExport(task))

    expect(read.id).toBe(task.id)
    expect(read.title).toBe(task.title)
    expect(read.version).toBe(task.version)
    expect(read.steps).toHaveLength(task.steps.length)
    expect(read.constraints.map((c) => c.rule)).toEqual(task.constraints.map((c) => c.rule))
  })

  it('finds every log in a full export', () => {
    const a = buildDemoTask()
    const b = { ...buildDemoTask(), id: 'second-task', title: 'Another task' }
    const read = parseExport(buildFullExport([a, b]))

    expect(read.map((t) => t.title)).toEqual([a.title, 'Another task'])
  })

  it('ignores the code blocks that are not a log', () => {
    const task = buildDemoTask()
    const noise = ['# Notes', '', '```json', '{ "hello": "world" }', '```', '']
    const read = parseExport([...noise, buildTaskExport(task)].join('\n'))

    expect(read).toHaveLength(1)
    expect(read[0].title).toBe(task.title)
  })

  it('refuses a file with no log, and says what to supply', () => {
    expect(() => parseExport('# Just a document\n\nNothing here.')).toThrow(NothingToImportError)
    expect(() => parseExport('')).toThrow(NothingToImportError)
  })

  it('survives a truncated JSON without taking the rest down', () => {
    const task = buildDemoTask()
    const broken = '```json\n{ "id": "x", "title": "T", "version": 1, \n```\n'
    const read = parseExport(broken + buildTaskExport(task))

    expect(read).toHaveLength(1)
    expect(read[0].title).toBe(task.title)
  })
})

describe('import', () => {
  it('adds a missing task, exactly as it stands', async () => {
    const incoming = { ...buildDemoTask(), id: 'from-elsewhere', title: 'From another machine' }
    const outcome = await store.importTasks([incoming])

    expect(outcome.imported).toEqual(['From another machine'])
    expect((await store.allTasks()).map((t) => t.title)).toContain('From another machine')
  })

  it('does not import the same unchanged log twice', async () => {
    const incoming = { ...buildDemoTask(), id: 'stable', title: 'Stable task' }
    await store.importTasks([incoming])
    const second = await store.importTasks([incoming])

    expect(second.skipped).toEqual(['Stable task'])
    expect((await store.allTasks()).filter((t) => t.title === 'Stable task')).toHaveLength(1)
  })

  it('NEVER overwrites a different version: it makes a copy', async () => {
    const original = await store.createAndOpenTask('Live task', 'Keep working')
    const stale = { ...original, version: original.version + 5, title: 'Live task' }

    const outcome = await store.importTasks([stale])

    // Overwriting would destroy work nobody asked to lose.
    expect(outcome.copied).toEqual(['Live task (imported)'])
    const kept = await store.allTasks()
    expect(kept.find((t) => t.id === original.id)!.version).toBe(original.version)
    expect(kept.map((t) => t.title)).toContain('Live task (imported)')
  })

  it('leaves the open log untouched', async () => {
    const open = await store.createAndOpenTask('Open task', 'Continue')
    await store.importTasks([{ ...buildDemoTask(), id: 'other', title: 'Other' }])

    expect(store.currentTask()!.id).toBe(open.id)
    expect(store.currentTask()!.version).toBe(open.version)
  })

  it('makes the full round trip through the file', async () => {
    const task = buildDemoTask()
    const outcome = await store.importTasks(parseExport(buildTaskExport(task)))

    expect(outcome.imported).toHaveLength(1)
    const restored = (await store.allTasks()).find((t) => t.id === task.id)!
    expect(restored.title).toBe(task.title)
    expect(restored.rejected.map((r) => r.approach)).toEqual(task.rejected.map((r) => r.approach))
    expect(restored.steps.map((s) => s.evidence?.content)).toEqual(
      task.steps.map((s) => s.evidence?.content),
    )
  })
})

describe('handing off to the agent', () => {
  it('copies the address and the instruction in one click', async () => {
    const task = await store.createAndOpenTask('Hand off', 'Continue')
    await waitFor(() => root.querySelector('#copy-handoff') !== null, 'button')

    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          written.push(t)
          return Promise.resolve()
        },
      },
    })

    button('Copy the hand-off for your agent').click()
    await waitFor(() => written.length > 0, 'copie')

    expect(written[0]).toContain(`/t/${task.id}`)
    expect(written[0]).toContain('Continue this task.')
    await waitFor(
      () => root.querySelector('[role="status"]')?.textContent?.includes('Copied') === true,
      'confirmation',
    )
  })

  it('says what to do when the clipboard is refused', async () => {
    await store.createAndOpenTask('Hand off', 'Continue')
    await waitFor(() => root.querySelector('#copy-handoff') !== null, 'button')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })

    button('Copy the hand-off for your agent').click()
    await waitFor(() => root.querySelector('[role="alert"]') !== null, 'refus')

    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Copy the address')
  })

  it('does not offer the hand-off on a closed task', async () => {
    await store.createAndOpenTask('Closing', 'x')
    await store.mutate((s) => ({ ...s, status: 'completed' as const, next: null }))
    await settled()

    expect(root.querySelector('#copy-handoff')).toBeNull()
  })
})

describe('import from the screen', () => {
  it('reads a file and reports what it did', async () => {
    await store.createAndOpenTask('Existing', 'Continue')
    await waitFor(() => root.querySelector('#import-file') !== null, 'file field')

    const incoming = { ...buildDemoTask(), id: 'from-file', title: 'From a file' }
    const field = root.querySelector<HTMLInputElement>('#import-file')!
    const file = new File([buildTaskExport(incoming)], 'keydler-logs.md', { type: 'text/markdown' })
    Object.defineProperty(field, 'files', { configurable: true, value: [file] })
    field.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(
      () => root.querySelector('[role="status"]')?.textContent?.includes('imported') === true,
      'compte rendered',
    )

    const message = root.querySelector('[role="status"]')!.textContent!
    expect(message).toContain('1 imported')
    // An export holds no credential: saying so stops anyone believing they
    // restored some.
    expect(message).toContain('Credentials are never in an export')
    expect((await store.allTasks()).map((t) => t.title)).toContain('From a file')
  })

  it('refuses a file that is not an export, without jargon', async () => {
    await store.createAndOpenTask('Existing', 'Continue')
    await waitFor(() => root.querySelector('#import-file') !== null, 'file field')

    const field = root.querySelector<HTMLInputElement>('#import-file')!
    const file = new File(['just some notes'], 'notes.md', { type: 'text/markdown' })
    Object.defineProperty(field, 'files', { configurable: true, value: [file] })
    field.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => root.querySelector('[role="alert"]') !== null, 'refus')
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('No log found')
  })
})

vi.setConfig({ testTimeout: 20_000 })
