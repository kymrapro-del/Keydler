import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, askHuman, logStep } from '../src/domain/task'
import { forgetSeen, markSeen, seenVersion } from '../src/persistence/seen'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('the memory of what you have already seen', () => {
  beforeEach(() => forgetSeen('t1'))

  it('claims nothing for a task never opened', () => {
    expect(seenVersion('t1')).toBeNull()
  })

  it('remembers the version, per task', () => {
    markSeen('t1', 7)
    markSeen('t2', 3)
    expect(seenVersion('t1')).toBe(7)
    expect(seenVersion('t2')).toBe(3)
    forgetSeen('t2')
  })

  it('never moves backwards', () => {
    markSeen('t1', 9)
    markSeen('t1', 4)
    expect(seenVersion('t1')).toBe(9)
  })

  it('survives a damaged value without bringing the page down', () => {
    localStorage.setItem('watch-log:seen:t1', 'not a number')
    expect(seenVersion('t1')).toBeNull()
  })
})

describe('while you were away', () => {
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

  const card = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('While you were away'),
    )

  async function open() {
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await settled()
  }

  beforeEach(async () => {
    localStorage.clear()
    store.__resetStore()
    await clearDatabase()
    await store.init()
    await open()
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    localStorage.clear()
    history.replaceState(null, '', '/')
  })

  it('shows nothing on the first opening', () => {
    expect(card()).toBeUndefined()
  })

  it('shows what an agent wrote while the page was closed', async () => {
    // The page is closed: nobody is looking, so the seen version stops
    // advancing. That is the only way to be really away.
    unmount()
    await store.mutate((s) =>
      logStep(
        s,
        { action: 'Rewrote the issuer while you were out', result: 'green', basedOnVersion: null },
        'agent',
      ),
    )
    await open()

    expect(card()).toBeDefined()
    expect(card()!.textContent).toContain('Rewrote the issuer while you were out')
    expect(card()!.textContent).toContain('Agent')
  })

  it('closes with one click, and does not come back', async () => {
    const id = store.currentTask()!.id
    unmount()
    await store.mutate((s) =>
      logStep(s, { action: 'Something happened', result: 'ok', basedOnVersion: null }, 'agent'),
    )
    await open()
    expect(card()).toBeDefined()

    root.querySelector<HTMLButtonElement>('#seen')!.click()
    __renderNow()

    expect(card()).toBeUndefined()
    expect(seenVersion(id)).toBe(store.currentTask()!.version)
  })

  it('brings forward a question an agent left', async () => {
    unmount()
    await store.mutate((s) =>
      askHuman(
        s,
        { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
        'agent',
      ),
    )
    await open()

    expect(card()!.textContent).toContain('Which region?')
  })

  it('does not count your own writes as an absence', async () => {
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      addConstraint(s, { rule: 'A rule I just typed', basedOnVersion: null }, 'human'),
    )
    await written(before)

    // We were there: the page kept up.
    expect(card()).toBeUndefined()
    expect(seenVersion(store.currentTask()!.id)).toBe(store.currentTask()!.version)
  })

  it('says nothing when only the page was reloaded with nothing new', async () => {
    unmount()
    await open()
    expect(card()).toBeUndefined()
  })
})

describe('a background tab does not count as a presence', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function hide(hidden: boolean) {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  const card = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('While you were away'),
    )

  beforeEach(async () => {
    localStorage.clear()
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
    hide(false)
    unmount()
    localStorage.clear()
    history.replaceState(null, '', '/')
  })

  it('reports what an agent wrote while the tab was hidden', async () => {
    hide(true)
    await store.mutate((s) =>
      logStep(
        s,
        { action: 'Wrote while you looked elsewhere', result: 'ok', basedOnVersion: null },
        'agent',
      ),
    )
    await waitUntil(() => store.currentTask()!.steps.length > 4, 'l’écriture de l’agent')

    // Without this the page would mark itself "seen" while nobody was looking,
    // and the digest would never fire.
    hide(false)
    await settled()

    expect(card()).toBeDefined()
    expect(card()!.textContent).toContain('Wrote while you looked elsewhere')
  })
})
