import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { askHuman, pendingApprovals, requestApproval } from '../src/domain/task'
import { attentionTitle } from '../src/ui/attention'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('le titre de l’onglet appelle quand il le faut', () => {
  const BASE = 'Keydler: a shared memory for you and your AI'

  it('ne change rien quand rien n’attend', () => {
    expect(attentionTitle(BASE, 0, true)).toBe(BASE)
    expect(attentionTitle(BASE, 0, false)).toBe(BASE)
  })

  it('ne crie pas quand l’onglet est déjà sous les yeux', () => {
    expect(attentionTitle(BASE, 2, true)).toBe(BASE)
  })

  it('compte ce qui attend quand l’onglet est caché', () => {
    expect(attentionTitle(BASE, 1, false)).toBe(`(1) ${BASE}`)
    expect(attentionTitle(BASE, 3, false)).toBe(`(3) ${BASE}`)
  })

  it('ne s’empile pas quand on le rappelle', () => {
    const once = attentionTitle(BASE, 1, false)
    expect(attentionTitle(once, 2, false)).toBe(`(2) ${BASE}`)
    expect(attentionTitle(once, 0, false)).toBe(BASE)
  })
})

describe('une demande d’autorisation à l’écran', () => {
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
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
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

  it('ne montre rien tant que rien n’a été demandé', () => {
    expect(card()).toBeUndefined()
  })

  it('montre l’action et son motif, et dit que l’agent attend', async () => {
    await ask()
    const shown = card()!
    expect(shown).toBeDefined()
    expect(shown.textContent).toContain('Run the migration against the staging replica')
    expect(shown.textContent).toContain('It rewrites 40k rows')
    expect(shown.textContent).toMatch(/waiting|blocked/i)
  })

  it('passe avant tout le reste, y compris la prochaine action', async () => {
    await ask()
    const cards = [...root.querySelectorAll('.card')]
    const permission = cards.indexOf(card()!)
    const next = cards.findIndex((c) => c.textContent?.includes('NEXT'))
    expect(permission).toBeGreaterThanOrEqual(0)
    if (next >= 0) expect(permission).toBeLessThan(next)
  })

  it('autorise d’un clic, et la carte disparaît', async () => {
    await ask()
    const id = pendingApprovals(store.currentTask()!)[0].id
    const before = store.currentTask()!.version

    root.querySelector<HTMLButtonElement>(`[data-allow="${id}"]`)!.click()
    await written(before)

    expect(pendingApprovals(store.currentTask()!)).toHaveLength(0)
    expect(store.currentTask()!.approvals.find((a) => a.id === id)!.decision).toBe('allowed')
    expect(card()).toBeUndefined()
  })

  it('refuse d’un clic, et le refus est conservé', async () => {
    await ask()
    const id = pendingApprovals(store.currentTask()!)[0].id
    const before = store.currentTask()!.version

    root.querySelector<HTMLButtonElement>(`[data-deny="${id}"]`)!.click()
    await written(before)

    expect(store.currentTask()!.approvals.find((a) => a.id === id)!.decision).toBe('denied')
  })

  it('met le compte dans le titre quand l’onglet est caché', async () => {
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
