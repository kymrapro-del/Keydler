import { beforeEach, describe, expect, it } from 'vitest'
import { isWorkspacePath, WORKSPACE_PATH } from '../src/webmcp/location'
import { __renderNow, mount } from '../src/ui/bench'
import * as store from '../src/store/taskStore'
import { clearDatabase } from './helpers'

// Where a "Sign in" button lands on a product with no account and no server.
// List, export and import existed already, folded inside an open log, so a
// visitor arriving from a home page saw nothing.
describe('the workspace address', () => {
  it('recognises its own, with or without a trailing slash', () => {
    expect(isWorkspacePath(WORKSPACE_PATH)).toBe(true)
    expect(isWorkspacePath(`${WORKSPACE_PATH}/`)).toBe(true)
  })

  it('recognises nothing else', () => {
    // `/workspaces` and `/workspace-2` are different addresses: matching them
    // here would take the page from any future route.
    for (const other of ['/', '/t/abc', '/workspaces', '/workspace-2', '/Workspace', '']) {
      expect(isWorkspacePath(other), other).toBe(false)
    }
  })
})

describe('the way in from the home screen', () => {
  it('is a link, not a button', async () => {
    // A control that changes the address has to be an <a href>: middle-click,
    // Ctrl+click and screen readers depend on it. It is also the site's only
    // crawl path, there being no other anchor.
    localStorage.clear()
    store.__resetStore()
    await clearDatabase()
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector<HTMLElement>('#app')!
    history.replaceState(null, '', '/')

    const unmount = mount(root)
    await store.init()
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()

    const porte = root.querySelector('#go-workspace')
    expect(porte?.tagName).toBe('A')
    expect(porte?.getAttribute('href')).toBe(WORKSPACE_PATH)

    ;(porte as HTMLAnchorElement).click()
    __renderNow()
    expect(location.pathname).toBe(WORKSPACE_PATH)
    expect(root.textContent).toContain('Your workspace lives in this browser')
    unmount()
  })
})

describe('the workspace page', () => {
  let root: HTMLElement
  let unmount: () => void

  async function waitForTurns(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
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
    await waitForTurns()

    expect(root.textContent).toContain('Your workspace lives in this browser')
    unmount()
  })

  it('keeps its address instead of being sent back to the root', async () => {
    // `reflectAddress` rewrites the address on every render to `/t/:id` or `/`.
    // Without an exception for this view, the address left for `/` on the first
    // render and a reload no longer brought the page back.
    unmount = mount(root)
    await store.init()
    await waitForTurns()

    expect(location.pathname).toBe(WORKSPACE_PATH)
    unmount()
  })

  it('says there is nothing when the device is empty', async () => {
    unmount = mount(root)
    await store.init()
    await waitForTurns()

    expect(root.textContent).toContain('Nothing is stored here yet')
    unmount()
  })

  it('lists EVERY log on the device, not only the one that is open', async () => {
    // `store.init()` with no id reopens the last log and `deleteCurrentTask`
    // reopens another: no state has logs without one open. An earlier version
    // of this test claimed the opposite; a mutant proved it wrong.
    await store.init()
    await store.createAndOpenTask('Refactor the auth module', 'Map the entry points')
    await store.createAndOpenTask('Ship the landing page', 'Replace the sign-in button')
    store.__resetStore()

    history.replaceState(null, '', WORKSPACE_PATH)
    unmount = mount(root)
    await store.init()
    await waitForTurns()
    await waitForTurns()

    expect(root.textContent).toContain('2 logs on this device')
    expect(root.textContent).toContain('Refactor the auth module')
    expect(root.textContent).toContain('Ship the landing page')
    expect(root.textContent).not.toContain('Nothing is stored here yet')
    unmount()
  })

  it('offers the export and the import, which lived behind an open log', async () => {
    unmount = mount(root)
    await store.init()
    await waitForTurns()

    expect(root.querySelector('#export-all')).not.toBeNull()
    expect(root.querySelector('#import')).not.toBeNull()
    unmount()
  })

  it('promises no account', async () => {
    // The product refuses to write "verified" in place of a human; its own page
    // must not suggest a backing it does not have.
    unmount = mount(root)
    await store.init()
    await waitForTurns()

    const text = root.textContent ?? ''
    expect(text).toContain('no account and no server')
    for (const word of ['Sign in', 'Log in', 'Create an account', 'password', 'Sync']) {
      expect(text, word).not.toContain(word)
    }
    unmount()
  })

  it('does not claim the logs are encrypted, because they are not', async () => {
    // Only the credential vault and sealed links are encrypted. The logs sit in
    // the clear in IndexedDB, readable by anyone with the browser session.
    // "Encrypted" here would be false.
    unmount = mount(root)
    await store.init()
    await waitForTurns()

    const text = (root.textContent ?? '').toLowerCase()
    for (const word of ['encrypted', 'encryption', 'end-to-end']) {
      expect(text, word).not.toContain(word)
    }
    unmount()
  })

  it('promises privacy only through what is verifiable', async () => {
    // An early draft said "nobody else can read it, not even us". That is a
    // promise about trust, and the code is served from here, so it could
    // change. What is demonstrable: no destination, and a policy that blocks
    // other origins.
    unmount = mount(root)
    await store.init()
    await waitForTurns()

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
    await waitForTurns()

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
    await waitForTurns()
    await waitForTurns()

    root.querySelector<HTMLButtonElement>(`[data-open="${task.id}"]`)!.click()
    await waitForTurns()
    await waitForTurns()

    expect(root.textContent).not.toContain('Your workspace lives in this browser')
    expect(location.pathname).toBe(`/t/${task.id}`)
    unmount()
  })
})
