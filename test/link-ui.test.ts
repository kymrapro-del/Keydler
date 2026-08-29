import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { FRAGMENT_KEY, packSealedTask, packTask } from '../src/export/link'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

let root: HTMLElement
let unmount: () => void
let copied: string | null

async function settled(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function open() {
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
  await settled()
}

beforeEach(async () => {
  copied = null
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        copied = t
        return Promise.resolve()
      },
    },
  })
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

describe('offering the log in a link', () => {
  it('copies an address that carries the whole log', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => copied !== null, 'the copy')
    await settled()

    expect(copied).toContain(`#${FRAGMENT_KEY}`)
    expect(copied!.length).toBeGreaterThan(200)
    // The fragment never leaves the browser: it is not sent to the server.
    expect(copied!.split('#')[0]).toContain('/t/')
  })

  // The link carries the evidence as it is, and command output can carry a
  // token or the name of an internal machine. Saying so after the click is
  // useless: the address is already in the clipboard.
  it('warns what travels BEFORE the click, not after', async () => {
    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')

    expect(zone).toContain('pieces of evidence travel with it')
    expect(zone).toContain('token or an internal hostname')
    // And it reassures about what cannot travel, because that is structural.
    expect(zone).toContain('Sealed credentials never travel')
  })

  it('stays quiet when no evidence is attached', async () => {
    // A warning shown for no reason teaches people to stop reading it.
    const bare = { ...buildDemoTask(), id: 'without-value-evidence', steps: [] }
    await store.openPreparedTask(bare)
    await settled()

    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).not.toContain('evidence travel')
    expect(zone).not.toContain('internal hostname')
    // The button itself is still offered.
    expect(root.querySelector('#copy-link')).not.toBeNull()
  })

  it('counts in the singular when there is only one piece of evidence', async () => {
    const demo = buildDemoTask()
    const one = {
      ...demo,
      id: 'some-evidence',
      steps: demo.steps.filter((s) => s.evidence !== null).slice(0, 1),
    }
    await store.openPreparedTask(one)
    await settled()

    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).toContain('One piece of evidence travels with it')
  })

  it('says what it just copied, and that it is a copy', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'the message')
    __renderNow()

    const message = root.querySelector('.notice--ok')!.textContent!
    expect(message.toLowerCase()).toContain('copy')
    // And it names what went with it, not just "the log".
    expect(message).toContain('evidence included')
  })
})

describe('receiving a log through a link', () => {
  async function arriveWith(packed: string) {
    unmount()
    store.__resetStore()
    await clearDatabase()
    // Like main.ts: the address is read before the store opens, so the task is
    // indeed bound to an id absent from this device.
    history.replaceState(null, '', `/t/notonthisdevice#${FRAGMENT_KEY}${packed}`)
    await store.init('notonthisdevice')
    await open()
  }

  const offer = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('A shared log'),
    )

  it('offers, and imports nothing on its own', async () => {
    const packed = await packTask(buildDemoTask())
    await arriveWith(packed)

    expect(offer()).toBeDefined()
    expect(offer()!.textContent).toContain('Refactor the authentication module')
    // Nothing was written: opening a link is not consenting to write it.
    expect(await store.allTasks()).toHaveLength(0)
  })

  it('does not contradict the offer with a "this task does not exist" banner', async () => {
    await arriveWith(await packTask(buildDemoTask()))

    // The address does point at a missing task, but the link carries exactly
    // what it takes to create it. Saying both at once alarms for nothing.
    expect(root.textContent).not.toContain('does not exist on this device')
    expect(offer()).toBeDefined()
  })

  it('says the task is missing again if the link is declined', async () => {
    await arriveWith(await packTask(buildDemoTask()))
    root.querySelector<HTMLButtonElement>('#decline-link')!.click()
    await settled()

    expect(root.textContent).toContain('does not exist on this device')
  })

  it('announces it will be a copy, with no tie to the original', async () => {
    await arriveWith(await packTask(buildDemoTask()))
    expect(offer()!.textContent!.toLowerCase()).toContain('copy')
  })

  it('imports on request, and opens the log it received', async () => {
    const source = buildDemoTask()
    await arriveWith(await packTask(source))

    root.querySelector<HTMLButtonElement>('#accept-link')!.click()
    await waitUntil(() => store.currentTask() !== null, 'the imported task', 3000)
    await settled()

    expect(store.currentTask()!.title).toBe(source.title)
    expect(store.currentTask()!.steps.length).toBe(source.steps.length)
    expect(offer()).toBeUndefined()
    // The address does not keep the payload: reloading would not offer again.
    expect(location.hash).toBe('')
  })

  it('declines in one click, and leaves the page as empty as before', async () => {
    await arriveWith(await packTask(buildDemoTask()))

    root.querySelector<HTMLButtonElement>('#decline-link')!.click()
    await settled()

    expect(offer()).toBeUndefined()
    expect(await store.allTasks()).toHaveLength(0)
    expect(location.hash).toBe('')
  })

  it('says a link is unreadable rather than letting the page look broken', async () => {
    await arriveWith('zdefinitivementpasuntask')
    await waitUntil(() => !!root.querySelector('.notice--error'), 'the error message', 3000)
    __renderNow()

    expect(root.querySelector('.notice--error')!.textContent).toMatch(/link/i)
    expect(offer()).toBeUndefined()
  })
})

describe('the protected link, from the screen', () => {
  async function arriveWith(packed: string) {
    unmount()
    store.__resetStore()
    await clearDatabase()
    history.replaceState(null, '', `/t/notonthisdevice#${FRAGMENT_KEY}${packed}`)
    await store.init('notonthisdevice')
    await open()
  }

  function type(id: string, value: string) {
    const field = root.querySelector<HTMLInputElement>(`#${id}`)!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('copies a sealed link, and says so without promising more than that', async () => {
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Copy a protected link',
    )!
    expect(button).toBeTruthy()

    const originalPrompt = window.prompt
    window.prompt = () => 'the passphrase from the phone call'
    button.click()
    await waitUntil(() => copied !== null, 'the copy')
    window.prompt = originalPrompt
    await settled()

    expect(copied).toContain(`#${FRAGMENT_KEY}s`)
    // Nothing of the log shows through in the address.
    expect(copied).not.toContain(store.currentTask()!.title.replace(/ /g, ''))
    expect(root.querySelector('.notice--ok')?.textContent).toContain('unreadable')
  })

  it('does not announce what it does not do', async () => {
    // The passphrase does not check an identity: it checks knowledge of a
    // secret. The screen must say so, and say why.
    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).toContain('Nobody can tell who opens a link')
    expect(zone).toContain('would need a server')
  })

  it('says nothing about the log until the passphrase is given', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'the passphrase from the phone call')
    const title = store.currentTask()!.title
    await arriveWith(packed)

    const text = root.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('A protected log')
    expect(text).not.toContain(title)
    expect(root.querySelector('#sealed-passphrase')).not.toBeNull()
  })

  it('opens with the right passphrase, and offers the copy as usual', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'the passphrase from the phone call')
    const title = store.currentTask()!.title
    await arriveWith(packed)

    type('sealed-passphrase', 'the passphrase from the phone call')
    root.querySelector<HTMLFormElement>('#form-sealed')!.requestSubmit()
    await waitUntil(() => root.textContent!.includes('A shared log'), 'the offer')
    __renderNow()

    expect(root.textContent).toContain(title)
    expect(root.querySelector('#accept-link')).not.toBeNull()
  })

  it('refuses a wrong passphrase while saying the link itself is fine', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'the passphrase from the phone call')
    await arriveWith(packed)

    type('sealed-passphrase', 'this is not the right one')
    root.querySelector<HTMLFormElement>('#form-sealed')!.requestSubmit()
    await waitUntil(() => !!root.querySelector('.notice--error'), 'the refusal')
    __renderNow()

    const message = root.querySelector('.notice--error')!.textContent!
    expect(message).toContain('does not open this link')
    expect(message).toContain('the link itself is fine')
    // And it stays open, so the passphrase can be typed again.
    expect(root.querySelector('#sealed-passphrase')).not.toBeNull()
  })
})
