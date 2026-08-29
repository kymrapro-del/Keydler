import { beforeEach, describe, expect, it } from 'vitest'
import { isWorkspacePath, WORKSPACE_PATH } from '../src/webmcp/location'
import { __renderNow, mount } from '../src/ui/bench'
import * as store from '../src/store/taskStore'
import { clearDatabase } from './helpers'

// `/workspace` is what a "Sign in" button has to reach on a product with no account and no
// server. The log list, the export and the import already existed, but folded inside an open
// log: whoever arrives from a home page has none, and so saw nothing.
describe('l’adresse de l’espace de travail', () => {
  it('reconnaît la sienne, avec ou sans barre finale', () => {
    expect(isWorkspacePath(WORKSPACE_PATH)).toBe(true)
    expect(isWorkspacePath(`${WORKSPACE_PATH}/`)).toBe(true)
  })

  it('ne reconnaît rien d’autre', () => {
    // `/workspaces` or `/workspace-2` must not open this view: they are
    // different addresses, and confusing them would steal their page from
    // any future routes.
    for (const other of ['/', '/t/abc', '/workspaces', '/workspace-2', '/Workspace', '']) {
      expect(isWorkspacePath(other), other).toBe(false)
    }
  })
})

describe('la porte d’entrée depuis l’accueil', () => {
  it('est un lien, pas un bouton', async () => {
    // A control that changes the address has to be an <a href>: middle-click,
    // Ctrl+click and screen readers depend on it. It is also the only crawl
    // path a search engine finds on this site, which has no other anchor.
    localStorage.clear()
    store.__resetStore()
    await clearDatabase()
    document.body.innerHTML = '<div id="app"></div>'
    const racine = document.querySelector<HTMLElement>('#app')!
    history.replaceState(null, '', '/')

    const unmount = mount(racine)
    await store.init()
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()

    const porte = racine.querySelector('#go-workspace')
    expect(porte?.tagName).toBe('A')
    expect(porte?.getAttribute('href')).toBe(WORKSPACE_PATH)
    unmount()
  })
})

describe('la page de l’espace de travail', () => {
  let root: HTMLElement
  let unmount: () => void

  async function attendre(tours = 8) {
    for (let i = 0; i < tours; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    localStorage.clear()
    store.__resetStore()
    await clearDatabase()
    document.body.innerHTML = '<div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    history.replaceState(null, '', WORKSPACE_PATH)
  })

  it('s’ouvre quand l’adresse la désigne, sans cahier ouvert', async () => {
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('Your workspace lives in this browser')
    unmount()
  })

  it('garde son adresse au lieu de se faire renvoyer à la racine', async () => {
    // `reflectAddress` rewrites the address on every render to `/t/:id` or `/`.
    // Without an exception for this view, the address left for `/` on the first
    // render and a reload no longer brought the page back.
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(location.pathname).toBe(WORKSPACE_PATH)
    unmount()
  })

  it('dit qu’il n’y a rien quand l’appareil est vide', async () => {
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('Nothing is stored here yet')
    unmount()
  })

  it('liste TOUS les cahiers du poste, pas seulement celui qui est ouvert', async () => {
    // `store.init()` with no id reopens the last log and `deleteCurrentTask` reopens another
    // one: no state has logs without one being open. A first version of this test claimed the
    // opposite, and a mutation proved it wrong.
    await store.init()
    await store.createAndOpenTask('Refactor the auth module', 'Map the entry points')
    await store.createAndOpenTask('Ship the landing page', 'Replace the sign-in button')
    store.__resetStore()

    history.replaceState(null, '', WORKSPACE_PATH)
    unmount = mount(root)
    await store.init()
    await attendre()
    await attendre()

    expect(root.textContent).toContain('2 logs on this device')
    expect(root.textContent).toContain('Refactor the auth module')
    expect(root.textContent).toContain('Ship the landing page')
    expect(root.textContent).not.toContain('Nothing is stored here yet')
    unmount()
  })

  it('offre l’export et l’import, qui vivaient derrière un cahier ouvert', async () => {
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.querySelector('#export-all')).not.toBeNull()
    expect(root.querySelector('#import')).not.toBeNull()
    unmount()
  })

  it('ne promet aucun compte', async () => {
    // The product refuses to write "verified" in place of a human; its own
    // page must not suggest a backing it does not have.
    unmount = mount(root)
    await store.init()
    await attendre()

    const text = root.textContent ?? ''
    expect(text).toContain('no account and no server')
    for (const mot of ['Sign in', 'Log in', 'Create an account', 'password', 'Sync']) {
      expect(text, mot).not.toContain(mot)
    }
    unmount()
  })

  it('ne prétend pas que les cahiers sont chiffrés, parce qu’ils ne le sont pas', async () => {
    // Only the credential vault and sealed links are encrypted. The logs
    // themselves sit in the clear in IndexedDB, and anyone with a hand on the
    // browser session can read them. Writing "encrypted" here would be the
    // only real falsehood this page could carry.
    unmount = mount(root)
    await store.init()
    await attendre()

    const text = (root.textContent ?? '').toLowerCase()
    for (const mot of ['encrypted', 'encryption', 'end-to-end']) {
      expect(text, mot).not.toContain(mot)
    }
    unmount()
  })

  it('ne promet la confidentialité que par ce qui est vérifiable', async () => {
    // A first draft said "nobody else can read it, not even us". That is a
    // promise about trust: we serve the code, so we could change it. What is
    // demonstrable is that there is no destination and that the security
    // policy blocks other origins.
    unmount = mount(root)
    await store.init()
    await attendre()

    const text = root.textContent ?? ''
    expect(text).toContain('never sent anywhere')
    expect(text).not.toContain('not even us')
    unmount()
  })

  it('avertit que vider le navigateur efface tout', async () => {
    // With no server, there is no backup anywhere else. Staying silent about
    // it would be the only false promise this page could make.
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('deletes every log here')
    unmount()
  })

  it('sort de la vue quand on ouvre un cahier depuis la liste', async () => {
    await store.init()
    const task = await store.createAndOpenTask('Refactor the auth module', 'Map the entry points')
    store.__resetStore()

    history.replaceState(null, '', WORKSPACE_PATH)
    unmount = mount(root)
    await store.init()
    await attendre()
    await attendre()

    root.querySelector<HTMLButtonElement>(`[data-open="${task.id}"]`)!.click()
    await attendre()
    await attendre()

    expect(root.textContent).not.toContain('Your workspace lives in this browser')
    expect(location.pathname).toBe(`/t/${task.id}`)
    unmount()
  })
})
