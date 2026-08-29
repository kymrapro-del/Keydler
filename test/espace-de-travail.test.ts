import { beforeEach, describe, expect, it } from 'vitest'
import { isWorkspacePath, WORKSPACE_PATH } from '../src/webmcp/location'
import { __renderNow, mount } from '../src/ui/bench'
import * as store from '../src/store/taskStore'
import { clearDatabase } from './helpers'

// `/workspace` is what a "Sign in" button has to reach on a product with no
// account and no server. The log list, the export and the import already
// existed, but folded inside an open log: whoever arrives from a home page has
// none, and so saw nothing.
describe('the workspace address', () => {
  it('recognises its own, with or without a trailing slash', () => {
    expect(isWorkspacePath(WORKSPACE_PATH)).toBe(true)
    expect(isWorkspacePath(`${WORKSPACE_PATH}/`)).toBe(true)
  })

  it('recognises nothing else', () => {
    // `/workspaces` or `/workspace-2` must not open this view: they are
    // different addresses, and confusing them would steal their page from any
    // future routes.
    for (const other of ['/', '/t/abc', '/workspaces', '/workspace-2', '/Workspace', '']) {
      expect(isWorkspacePath(other), other).toBe(false)
    }
  })
})

describe('the way in from the home screen', () => {
  it('is a link, not a button', async () => {
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

describe('the workspace page', () => {
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

  it('opens when the address names it, with no log open', async () => {
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('Your workspace lives in this browser')
    unmount()
  })

  it('keeps its address instead of being sent back to the root', async () => {
    // `reflectAddress` rewrites the address on every render to `/t/:id` or `/`.
    // Without an exception for this view, the address left for `/` on the first
    // render and a reload no longer brought the page back.
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(location.pathname).toBe(WORKSPACE_PATH)
    unmount()
  })

  it('says there is nothing when the device is empty', async () => {
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('Nothing is stored here yet')
    unmount()
  })

  it('lists EVERY log on the device, not only the one that is open', async () => {
    // `store.init()` with no id reopens the last log and `deleteCurrentTask`
    // reopens another one: no state has logs without one being open. A first
    // version of this test claimed the opposite, and a mutation proved it
    // wrong.
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

  it('offers the export and the import, which lived behind an open log', async () => {
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.querySelector('#export-all')).not.toBeNull()
    expect(root.querySelector('#import')).not.toBeNull()
    unmount()
  })

  it('promises no account', async () => {
    // The product refuses to write "verified" in place of a human; its own page
    // must not suggest a backing it does not have.
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

  it('does not claim the logs are encrypted, because they are not', async () => {
    // Only the credential vault and sealed links are encrypted. The logs
    // themselves sit in the clear in IndexedDB, and anyone with a hand on the
    // browser session can read them. Writing "encrypted" here would be the only
    // real falsehood this page could carry.
    unmount = mount(root)
    await store.init()
    await attendre()

    const text = (root.textContent ?? '').toLowerCase()
    for (const mot of ['encrypted', 'encryption', 'end-to-end']) {
      expect(text, mot).not.toContain(mot)
    }
    unmount()
  })

  it('promises privacy only through what is verifiable', async () => {
    // A first draft said "nobody else can read it, not even us". That is a
    // promise about trust: we serve the code, so we could change it. What is
    // demonstrable is that there is no destination and that the security policy
    // blocks other origins.
    unmount = mount(root)
    await store.init()
    await attendre()

    const text = root.textContent ?? ''
    expect(text).toContain('never sent anywhere')
    expect(text).not.toContain('not even us')
    unmount()
  })

  it('warns that clearing the browser erases everything', async () => {
    // With no server, there is no backup anywhere else. Staying silent about it
    // would be the only false promise this page could make.
    unmount = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('deletes every log here')
    unmount()
  })

  it('leaves the view when a log is opened from the list', async () => {
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
