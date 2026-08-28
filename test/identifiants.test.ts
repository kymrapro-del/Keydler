import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addSecret,
  DuplicateSecretNameError,
  editSecret,
  listSecretNames,
  revealSecret,
} from '../src/persistence/vault'
import * as store from '../src/store/taskStore'
import { __renderNow, mount, REVEAL_TTL } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

const PASSPHRASE = 'correct horse battery'

describe('corriger un identifiant sans le desceller', () => {
  beforeEach(clearDatabase)

  const base = {
    taskId: 'task-edit',
    name: 'gemini-key',
    purpose: 'Gemini calls',
    value: 'AIzaSy-original',
    passphrase: PASSPHRASE,
  }

  it('renomme et reformule sans jamais redemander la valeur', async () => {
    const { id } = await addSecret(base)
    await editSecret(id, { name: 'gemini-api-key', purpose: 'Calls Gemini from the ingest job' })

    const [named] = await listSecretNames('task-edit')
    expect(named.name).toBe('gemini-api-key')
    expect(named.purpose).toBe('Calls Gemini from the ingest job')

    // La valeur scellée n'a pas bougé : c'est tout l'intérêt de ne pas la
    // redemander pour corriger une faute de frappe.
    expect(await revealSecret(id, PASSPHRASE)).toBe('AIzaSy-original')
  })

  it('refuse un renommage qui créerait un doublon', async () => {
    await addSecret(base)
    const { id } = await addSecret({ ...base, name: 'stripe-key', value: 'sk-other' })

    await expect(editSecret(id, { name: 'gemini-key', purpose: 'x' })).rejects.toBeInstanceOf(
      DuplicateSecretNameError,
    )
  })

  it('accepte qu’un identifiant garde son propre nom', async () => {
    const { id } = await addSecret(base)
    await editSecret(id, { name: 'gemini-key', purpose: 'A better description' })
    expect((await listSecretNames('task-edit'))[0].purpose).toBe('A better description')
  })

  it('applique les mêmes règles de nom qu’à la création', async () => {
    const { id } = await addSecret(base)
    await expect(editSecret(id, { name: 'has spaces', purpose: 'x' })).rejects.toThrow()
    await expect(editSecret(id, { name: 'ok-name', purpose: '' })).rejects.toThrow()
  })
})

describe('une valeur révélée ne reste pas à l’écran', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.createAndOpenTask('Ship the issuer', 'Read the spec')
    await settled()
  })

  afterEach(() => {
    unmount()
    vi.useRealTimers()
    history.replaceState(null, '', '/')
  })

  it('se referme toute seule après un moment', async () => {
    const fill = (id: string, value: string) => {
      const field = root.querySelector<HTMLInputElement>(`#${id}`)!
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }

    fill('new-secret-name', 'gemini-api-key')
    fill('new-secret-purpose', 'Gemini calls')
    fill('new-secret-value', 'AIzaSy-on-screen')
    fill('new-secret-passphrase', PASSPHRASE)
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()

    await waitUntil(() => !!root.querySelector('[data-reveal]'), 'l’identifiant à apparaître', 3000)

    vi.stubGlobal(
      'prompt',
      vi.fn(() => PASSPHRASE),
    )
    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitUntil(() => !!root.querySelector('[data-revealed]'), 'la valeur à s’afficher', 3000)
    expect(root.querySelector('[data-revealed]')!.textContent).toContain('AIzaSy-on-screen')

    await vi.advanceTimersByTimeAsync(REVEAL_TTL + 1000)
    __renderNow()

    // Une valeur en clair oubliée sur un écran partagé est exactement ce que
    // le scellement était censé éviter.
    expect(root.querySelector('[data-revealed]')).toBeNull()
    expect(root.textContent).not.toContain('AIzaSy-on-screen')
  })
})

describe('corriger et supprimer ne se marchent pas dessus', () => {
  let root: HTMLElement
  let unmount: () => void

  async function seal(name: string, purpose: string) {
    const fill = (id: string, value: string) => {
      const field = root.querySelector<HTMLInputElement>(`#${id}`)!
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const before = root.querySelectorAll('[data-reveal]').length
    fill('new-secret-name', name)
    fill('new-secret-purpose', purpose)
    fill('new-secret-value', `value-of-${name}`)
    fill('new-secret-passphrase', PASSPHRASE)
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()
    await waitUntil(
      () => root.querySelectorAll('[data-reveal]').length > before,
      `l’identifiant ${name}`,
      3000,
    )
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.createAndOpenTask('Ship the issuer', 'Read the spec')
    await waitUntil(() => !!root.querySelector('#form-secret'), 'le formulaire d’identifiant')
    await seal('gemini-api-key', 'Gemini calls')
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('préremplit la correction avec ce qui est enregistré', async () => {
    root.querySelector<HTMLButtonElement>('[data-edit-secret]')!.click()
    __renderNow()

    expect(root.querySelector<HTMLInputElement>('#edit-value')!.value).toBe('gemini-api-key')
    expect(root.querySelector<HTMLInputElement>('#edit-reason')!.value).toBe('Gemini calls')
  })
})
