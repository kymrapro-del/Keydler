import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, askHuman, logStep } from '../src/domain/task'
import { forgetSeen, markSeen, seenVersion } from '../src/persistence/seen'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('la mémoire de ce que vous avez déjà vu', () => {
  beforeEach(() => forgetSeen('t1'))

  it('ne prétend rien pour une tâche jamais ouverte', () => {
    expect(seenVersion('t1')).toBeNull()
  })

  it('retient la version, par tâche', () => {
    markSeen('t1', 7)
    markSeen('t2', 3)
    expect(seenVersion('t1')).toBe(7)
    expect(seenVersion('t2')).toBe(3)
    forgetSeen('t2')
  })

  it('n’avance jamais à reculons', () => {
    markSeen('t1', 9)
    markSeen('t1', 4)
    expect(seenVersion('t1')).toBe(9)
  })

  it('survit à une valeur abîmée sans faire tomber la page', () => {
    localStorage.setItem('watch-log:seen:t1', 'not a number')
    expect(seenVersion('t1')).toBeNull()
  })
})

describe('pendant votre absence', () => {
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

  it('ne montre rien à la première ouverture', () => {
    expect(card()).toBeUndefined()
  })

  it('montre ce qu’un agent a écrit pendant que la page était fermée', async () => {
    // La page est fermée : personne ne regarde, donc la version vue n'avance
    // plus. C'est la seule façon d'être vraiment absent.
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

  it('se referme d’un clic, et ne revient pas', async () => {
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

  it('met en avant une question laissée par un agent', async () => {
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

  it('ne compte pas vos propres écritures comme une absence', async () => {
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      addConstraint(s, { rule: 'A rule I just typed', basedOnVersion: null }, 'human'),
    )
    await written(before)

    // On était là : la page a suivi.
    expect(card()).toBeUndefined()
    expect(seenVersion(store.currentTask()!.id)).toBe(store.currentTask()!.version)
  })

  it('ne dit rien quand seule la page a été rechargée sans rien de neuf', async () => {
    unmount()
    await open()
    expect(card()).toBeUndefined()
  })
})

describe('un onglet en arrière-plan ne compte pas comme une présence', () => {
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

  it('rapporte ce qu’un agent a écrit pendant que l’onglet était caché', async () => {
    hide(true)
    await store.mutate((s) =>
      logStep(
        s,
        { action: 'Wrote while you looked elsewhere', result: 'ok', basedOnVersion: null },
        'agent',
      ),
    )
    await waitUntil(() => store.currentTask()!.steps.length > 4, 'l’écriture de l’agent')

    // Sans cela, la page se marquerait « vue » alors que personne ne regardait,
    // et le digest ne se déclencherait jamais.
    hide(false)
    await settled()

    expect(card()).toBeDefined()
    expect(card()!.textContent).toContain('Wrote while you looked elsewhere')
  })
})
