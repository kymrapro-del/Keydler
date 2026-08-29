import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { askHuman, pendingApprovals, requestApproval } from '../src/domain/task'
import { attentionTitle } from '../src/ui/attention'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('the tab title calls out when it should', () => {
  const BASE = 'Keydler: a shared memory for you and your AI'

  it('changes nothing when nothing is waiting', () => {
    expect(attentionTitle(BASE, 0, true)).toBe(BASE)
    expect(attentionTitle(BASE, 0, false)).toBe(BASE)
  })

  it('does not shout when the tab is already in view', () => {
    expect(attentionTitle(BASE, 2, true)).toBe(BASE)
  })

  it('counts what is waiting when the tab is hidden', () => {
    expect(attentionTitle(BASE, 1, false)).toBe(`(1) ${BASE}`)
    expect(attentionTitle(BASE, 3, false)).toBe(`(3) ${BASE}`)
  })

  it('does not stack up when it is called again', () => {
    const once = attentionTitle(BASE, 1, false)
    expect(attentionTitle(once, 2, false)).toBe(`(2) ${BASE}`)
    expect(attentionTitle(once, 0, false)).toBe(BASE)
  })
})

describe('a permission request on screen', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function written(before: number) {
    await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'the write')
    __renderNow()
  }

  const card = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Permission to act'),
    )

  async function ask() {
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      requestApproval(
        s,
        {
          action: 'Run the migration against the staging replica',
          why: 'It rewrites 40k rows and I cannot undo it.',
          basedOnVersion: null,
        },
        'agent',
      ),
    )
    await written(before)
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    document.title = 'Keydler'
    history.replaceState(null, '', '/')
  })

  it('shows nothing until something has been asked', () => {
    expect(card()).toBeUndefined()
  })

  it('shows the action and its reason, and says the agent is waiting', async () => {
    await ask()
    const shown = card()!
    expect(shown).toBeDefined()
    expect(shown.textContent).toContain('Run the migration against the staging replica')
    expect(shown.textContent).toContain('It rewrites 40k rows')
    expect(shown.textContent).toMatch(/waiting|blocked/i)
  })

  it('comes before everything else, including the next action', async () => {
    await ask()
    const cards = [...root.querySelectorAll('.card')]
    const permission = cards.indexOf(card()!)
    const next = cards.findIndex((c) => c.textContent?.includes('NEXT'))
    expect(permission).toBeGreaterThanOrEqual(0)
    if (next >= 0) expect(permission).toBeLessThan(next)
  })

  it('allows in one click, and the card disappears', async () => {
    await ask()
    const id = pendingApprovals(store.currentTask()!)[0].id
    const before = store.currentTask()!.version

    root.querySelector<HTMLButtonElement>(`[data-allow="${id}"]`)!.click()
    await written(before)

    expect(pendingApprovals(store.currentTask()!)).toHaveLength(0)
    expect(store.currentTask()!.approvals.find((a) => a.id === id)!.decision).toBe('allowed')
    expect(card()).toBeUndefined()
  })

  it('denies in one click, and the refusal is kept', async () => {
    await ask()
    const id = pendingApprovals(store.currentTask()!)[0].id
    const before = store.currentTask()!.version

    root.querySelector<HTMLButtonElement>(`[data-deny="${id}"]`)!.click()
    await written(before)

    expect(store.currentTask()!.approvals.find((a) => a.id === id)!.decision).toBe('denied')
  })

  it('puts the count in the title when the tab is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })

    await ask()
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      askHuman(s, { question: 'Which region?', why: 'endpoint', basedOnVersion: null }, 'agent'),
    )
    await written(before)

    // A blocking request and an open question: two things to deal with.
    expect(document.title).toMatch(/^\(2\)/)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await settled()

    expect(document.title).not.toMatch(/^\(/)
  })
})
