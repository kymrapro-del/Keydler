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

describe('savoir si le travail tient sur cet appareil', () => {
  it('dit « inconnu » quand le navigateur ne répond pas là-dessus', async () => {
    noStorage()
    const state = await readStorage()
    expect(state.persisted).toBeNull()
    expect(state.usage).toBeNull()
  })

  it('rapporte l’état et la place occupée', async () => {
    fakeStorage()
    const state = await readStorage()
    expect(state.persisted).toBe(false)
    expect(state.usage).toBe(1_048_576)
    expect(state.quota).toBe(1_073_741_824)
  })

  it('survit à un navigateur qui refuse la question', async () => {
    fakeStorage({ estimate: () => Promise.reject(new Error('nope')) })
    const state = await readStorage()
    expect(state.persisted).toBe(false)
    expect(state.usage).toBeNull()
  })

  it('demande la durabilité, et rend ce que le navigateur a décidé', async () => {
    fakeStorage({ persist: () => Promise.resolve(true) })
    expect(await askForPersistence()).toBe(true)

    fakeStorage({ persist: () => Promise.resolve(false) })
    expect(await askForPersistence()).toBe(false)

    noStorage()
    expect(await askForPersistence()).toBeNull()
  })

  it('n’affirme jamais que le travail est à l’abri quand il ne l’est pas', () => {
    const fragile: StorageState = { persisted: false, usage: 1024, quota: 2048 }
    const text = describeStorage(fragile)
    expect(text.toLowerCase()).toContain('may')
    expect(text.toLowerCase()).not.toContain('safe')
  })

  it('reste prudent même quand la durabilité est accordée', () => {
    const solide: StorageState = { persisted: true, usage: 1024, quota: 2048 }
    const text = describeStorage(solide)
    // The browser promises not to clear it on its own, not that nothing will
    // ever happen.
    expect(text).toMatch(/will not|won’t/i)
    expect(text.toLowerCase()).toContain('you can still')
  })

  it('dit son ignorance plutôt que d’inventer', () => {
    expect(describeStorage({ persisted: null, usage: null, quota: null })).toMatch(
      /cannot|unknown/i,
    )
  })

  it('rend la place occupée en unités lisibles', () => {
    expect(describeStorage({ persisted: true, usage: 1_048_576, quota: 0 })).toContain('1.0 MB')
    expect(describeStorage({ persisted: true, usage: 2048, quota: 0 })).toContain('2 KB')
  })
})

describe('à l’écran', () => {
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

  it('dit sous les détails techniques où en est le stockage', async () => {
    const details = root.querySelector('details.technical')!
    await waitUntil(() => details.textContent!.includes('MB'), 'la mesure de stockage', 3000)
    expect(details.textContent).toMatch(/may/i)
  })

  it('propose de le demander, et ne le fait pas dans le dos de l’humain', async () => {
    await waitUntil(() => !!root.querySelector('#persist'), 'le bouton', 3000)

    const asked = vi.fn(() => Promise.resolve(true))
    fakeStorage({ persist: asked, persisted: () => Promise.resolve(true) })

    root.querySelector<HTMLButtonElement>('#persist')!.click()
    await waitUntil(() => asked.mock.calls.length > 0, 'la demande', 3000)
    await waitUntil(() => !root.querySelector('#persist'), 'le bouton retiré', 3000)

    // The node is replaced on every render: read it again, do not keep the old one.
    expect(root.querySelector('details.technical')!.textContent).toMatch(/will not|won’t/i)
  })

  it('dit quand le navigateur a refusé, plutôt que de ne rien faire', async () => {
    await waitUntil(() => !!root.querySelector('#persist'), 'le bouton', 3000)
    fakeStorage({ persist: () => Promise.resolve(false) })

    root.querySelector<HTMLButtonElement>('#persist')!.click()
    await waitUntil(
      () => !!root.querySelector('.notice--ok') || !!root.querySelector('.notice--error'),
      'un retour visible',
      3000,
    )
    __renderNow()

    // A click with no visible effect reads as a broken button.
    const message = root.querySelector('.notice--ok, .notice--error')!.textContent!
    expect(message.toLowerCase()).toContain('declined')
    expect(root.querySelector('#persist')).not.toBeNull()
  })

  it('signale une page hors ligne, et seulement alors', async () => {
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
