import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  askForPersistence,
  describeStorage,
  readStorage,
  type StorageState,
} from '../src/persistence/durability'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

function fakeStorage(over: Partial<StorageManager> = {}) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
      estimate: () => Promise.resolve({ usage: 1_048_576, quota: 1_073_741_824 }),
      ...over,
    },
  })
}

function noStorage() {
  Reflect.deleteProperty(navigator, 'storage')
}

afterEach(noStorage)

describe('knowing whether the work holds on this device', () => {
  it('says "unknown" when the browser will not answer that', async () => {
    noStorage()
    const state = await readStorage()
    expect(state.persisted).toBeNull()
    expect(state.usage).toBeNull()
  })

  it('reports the state and the space taken', async () => {
    fakeStorage()
    const state = await readStorage()
    expect(state.persisted).toBe(false)
    expect(state.usage).toBe(1_048_576)
    expect(state.quota).toBe(1_073_741_824)
  })

  it('survives a browser that refuses the question', async () => {
    fakeStorage({ estimate: () => Promise.reject(new Error('nope')) })
    const state = await readStorage()
    expect(state.persisted).toBe(false)
    expect(state.usage).toBeNull()
  })

  it('asks for durability, and returns what the browser decided', async () => {
    fakeStorage({ persist: () => Promise.resolve(true) })
    expect(await askForPersistence()).toBe(true)

    fakeStorage({ persist: () => Promise.resolve(false) })
    expect(await askForPersistence()).toBe(false)

    noStorage()
    expect(await askForPersistence()).toBeNull()
  })

  it('never claims the work is safe when it is not', () => {
    const fragile: StorageState = { persisted: false, usage: 1024, quota: 2048 }
    const text = describeStorage(fragile)
    expect(text.toLowerCase()).toContain('may')
    expect(text.toLowerCase()).not.toContain('safe')
  })

  it('stays careful even when durability is granted', () => {
    const solide: StorageState = { persisted: true, usage: 1024, quota: 2048 }
    const text = describeStorage(solide)
    // The browser promises not to clear it on its own, not that nothing will
    // ever happen.
    expect(text).toMatch(/will not|won’t/i)
    expect(text.toLowerCase()).toContain('you can still')
  })

  it('says it does not know rather than inventing', () => {
    expect(describeStorage({ persisted: null, usage: null, quota: null })).toMatch(
      /cannot|unknown/i,
    )
  })

  it('renders the space taken in readable units', () => {
    expect(describeStorage({ persisted: true, usage: 1_048_576, quota: 0 })).toContain('1.0 MB')
    expect(describeStorage({ persisted: true, usage: 2048, quota: 0 })).toContain('2 KB')
  })
})

describe('on screen', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    fakeStorage()
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
    noStorage()
    history.replaceState(null, '', '/')
  })

  it('says under the technical details where storage stands', async () => {
    const details = root.querySelector('details.technical')!
    await waitUntil(() => details.textContent!.includes('MB'), 'the storage reading', 3000)
    expect(details.textContent).toMatch(/may/i)
  })

  it("offers to ask for it, and does not do it behind the human's back", async () => {
    await waitUntil(() => !!root.querySelector('#persist'), 'the button', 3000)

    const asked = vi.fn(() => Promise.resolve(true))
    fakeStorage({ persist: asked, persisted: () => Promise.resolve(true) })

    root.querySelector<HTMLButtonElement>('#persist')!.click()
    await waitUntil(() => asked.mock.calls.length > 0, 'the request', 3000)
    await waitUntil(() => !root.querySelector('#persist'), 'the button to go', 3000)

    // The node is replaced on every render: read it again, do not keep the old
    // one.
    expect(root.querySelector('details.technical')!.textContent).toMatch(/will not|won’t/i)
  })

  it('says when the browser declined, rather than doing nothing', async () => {
    await waitUntil(() => !!root.querySelector('#persist'), 'the button', 3000)
    fakeStorage({ persist: () => Promise.resolve(false) })

    root.querySelector<HTMLButtonElement>('#persist')!.click()
    await waitUntil(
      () => !!root.querySelector('.notice--ok') || !!root.querySelector('.notice--error'),
      'visible feedback',
      3000,
    )
    __renderNow()

    // A click with no visible effect reads as a broken button.
    const message = root.querySelector('.notice--ok, .notice--error')!.textContent!
    expect(message.toLowerCase()).toContain('declined')
    expect(root.querySelector('#persist')).not.toBeNull()
  })

  it('flags an offline page, and only then', async () => {
    expect(root.querySelector('.offline')).toBeNull()

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
    await settled()
    expect(root.querySelector('.offline')).not.toBeNull()
    expect(root.querySelector('.offline')!.textContent).toMatch(/offline/i)

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.dispatchEvent(new Event('online'))
    await settled()
    expect(root.querySelector('.offline')).toBeNull()
  })
})
