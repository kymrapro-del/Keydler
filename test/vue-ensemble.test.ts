import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { askHuman, requestApproval } from '../src/domain/task'
import { needsYou, summariseNeeds } from '../src/domain/attention'
import { recentlyActive } from '../src/webmcp/witness'
import { recordCall, resetCalls } from '../src/webmcp/witness'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('summarising what is waiting, in few words', () => {
  it('says nothing when nothing is waiting', () => {
    expect(summariseNeeds([])).toBeNull()
  })

  it('names the one thing to do', () => {
    const task = askHuman(
      buildCoreTask(),
      { question: 'q?', why: 'w', basedOnVersion: null },
      'agent',
    )
    const summary = summariseNeeds(needsYou({ ...task, steps: [], constraints: [], rejected: [] }))
    expect(summary).toContain('1 question')
  })

  it('counts the rest rather than listing it all', () => {
    const task = buildCoreTask()
    const summary = summariseNeeds(needsYou(task))!
    // A full list inside a switcher badge does not get read.
    expect(summary).toMatch(/\+\d+ more|and \d+ more/)
    expect(summary.length).toBeLessThan(60)
  })

  it('puts what blocks an agent first', () => {
    const task = requestApproval(
      askHuman(buildCoreTask(), { question: 'q?', why: 'w', basedOnVersion: null }, 'agent'),
      { action: 'a', why: 'w', basedOnVersion: null },
      'agent',
    )
    expect(summariseNeeds(needsYou(task))!).toMatch(/^1 agent is blocked/)
  })
})

describe('has an agent just written?', () => {
  beforeEach(resetCalls)
  afterEach(() => {
    vi.useRealTimers()
    resetCalls()
  })

  it('claims nothing when no tool has been called', () => {
    expect(recentlyActive()).toBeNull()
  })

  it('reports the last call, and how old it is', () => {
    recordCall('log_step', false)
    const seen = recentlyActive()!
    expect(seen.tool).toBe('log_step')
    expect(seen.at).toBeTypeOf('number')
  })

  it('stays quiet when the last call is old', () => {
    vi.useFakeTimers()
    recordCall('log_step', false)
    vi.advanceTimersByTime(20 * 60_000)
    expect(recentlyActive()).toBeNull()
  })

  it('does not say an agent is connected: only that it called', () => {
    recordCall('resume_task', false)
    expect(recentlyActive()!.tool).toBe('resume_task')
  })
})

describe('the switcher says what is waiting, task by task', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 10) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  const switcher = () => root.querySelector('.switcher')

  beforeEach(async () => {
    resetCalls()
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)

    const blocked = requestApproval(
      { ...buildCoreTask(), title: 'Migration work' },
      { action: 'Drop the table', why: 'irreversible', basedOnVersion: null },
      'agent',
    )
    await store.openPreparedTask(blocked)
    await store.createAndOpenTask('Quiet task', 'Nothing pending')
    await settled()
  })

  afterEach(() => {
    unmount()
    resetCalls()
    history.replaceState(null, '', '/')
  })

  it('flags the blocked task from the one you are looking at', async () => {
    await waitUntil(() => !!switcher()?.textContent?.includes('Migration work'), 'la liste', 3000)
    __renderNow()

    const line = [...switcher()!.querySelectorAll('li')].find((li) =>
      li.textContent!.includes('Migration work'),
    )!
    // The title does not contain the word: it really is the badge speaking.
    const badge = line.querySelector('.needs__badge')!
    expect(badge).not.toBeNull()
    expect(badge.textContent).toMatch(/blocked/i)
  })

  it('puts no badge on a task that is waiting for nothing', async () => {
    await store.createAndOpenTask('Third task', 'x')
    await waitUntil(() => !!switcher()?.textContent?.includes('Quiet task'), 'la liste', 3000)
    __renderNow()

    const line = [...switcher()!.querySelectorAll('li')].find((li) =>
      li.textContent!.includes('Quiet task'),
    )!
    expect(line.querySelector('.needs__badge')).toBeNull()
  })

  it('says in the header that an agent just called a tool', async () => {
    expect(root.querySelector('.agent-live')).toBeNull()

    recordCall('log_step', false)
    await settled()

    const live = root.querySelector('.agent-live')!
    expect(live).not.toBeNull()
    expect(live.textContent).toContain('log_step')
    // We report an observed call, not a presumed presence.
    expect(live.textContent!.toLowerCase()).not.toContain('connected')
  })
})
