import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint } from '../src/domain/task'
import { searchTask } from '../src/domain/search'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('search on screen', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function type(value: string) {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const results = () => root.querySelector('[aria-labelledby="search-title"]')

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
    history.replaceState(null, '', '/')
  })

  it('counts the results of each section, not just the total', async () => {
    type('token')
    await settled()

    const here = searchTask(store.currentTask()!, 'token').length
    expect(here).toBeGreaterThan(0)

    const headings = [...results()!.querySelectorAll('h3')].map((h) => h.textContent ?? '')
    // A subheading without a count forces you to count the rows yourself to
    // know whether the answer is here or elsewhere.
    expect(headings[0]).toContain(String(here))
    expect(headings[1]).toMatch(/\d/)
  })

  it('jumps to the search field on "/", without typing the slash', async () => {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.blur()

    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)

    expect(document.activeElement).toBe(field)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not hijack "/" while you are typing elsewhere', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()

    const action = root.querySelector<HTMLInputElement>('#step-action')!
    action.focus()
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    action.dispatchEvent(event)

    expect(document.activeElement).toBe(action)
    expect(event.defaultPrevented).toBe(false)
  })

  it('clears the search on Escape and gives the focus back to the field', async () => {
    type('token')
    await settled()
    expect(results()).not.toBeNull()

    const field = root.querySelector<HTMLInputElement>('#search')!
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()

    expect(results()).toBeNull()
    expect(root.querySelector<HTMLInputElement>('#search')!.value).toBe('')
  })

  it('stays usable when everything matches, without dumping it all', async () => {
    for (let i = 0; i < 60; i++) {
      await store.mutate((s) =>
        addConstraint(s, { rule: `Rule about widgets number ${i}`, basedOnVersion: null }, 'human'),
      )
    }
    await waitUntil(() => (store.currentTask()?.constraints.length ?? 0) >= 60, 'les 60 règles')
    type('widgets')
    await settled()

    const rows = results()!.querySelectorAll('.rows > li').length
    expect(rows).toBeLessThanOrEqual(41)
    expect(results()!.textContent).toContain('more not shown')
  })
})

describe('the keyboard closes what is open', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
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
    history.replaceState(null, '', '/')
  })

  function escape(from: Element = document.body) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    from.dispatchEvent(event)
    __renderNow()
    return event
  }

  it('closes the step form, without having to aim at the Cancel button', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()
    expect(root.querySelector('#form-step')).not.toBeNull()

    escape(root.querySelector('#step-action')!)
    expect(root.querySelector('#form-step')).toBeNull()
  })

  it('closes the edit in progress', async () => {
    root.querySelector<HTMLButtonElement>('#edit-title')!.click()
    __renderNow()
    expect(root.querySelector('#edit-form')).not.toBeNull()

    escape(root.querySelector('#edit-value')!)
    expect(root.querySelector('#edit-form')).toBeNull()
  })

  it('closes the new task form', async () => {
    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()
    expect(root.querySelector('#create-task')).not.toBeNull()

    escape(root.querySelector('#new-title')!)
    expect(root.querySelector('#create-task')).toBeNull()
  })

  it('closes nothing when nothing is open, and lets the key through', () => {
    const event = escape()
    expect(event.defaultPrevented).toBe(false)
  })

  it('closes what is on screen: the search hides the form', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()
    expect(root.querySelector('#form-step')).not.toBeNull()

    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = 'issuer'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()
    // The form is no longer on screen: closing "the form" first would give the
    // impression that the key does nothing.
    expect(root.querySelector('#form-step')).toBeNull()

    escape()
    expect(root.querySelector<HTMLInputElement>('#search')!.value).toBe('')
    expect(root.querySelector('#form-step')).not.toBeNull()

    escape(root.querySelector('#step-action')!)
    expect(root.querySelector('#form-step')).toBeNull()
  })
})

describe('highlighting', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.createAndOpenTask('Ship the issuer', 'Read the spec')
    await store.mutate((s) =>
      addConstraint(
        s,
        {
          rule: 'The token issuer signs the token, and the token carries no token',
          basedOnVersion: null,
        },
        'human',
      ),
    )
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('marks every occurrence, not just the first', async () => {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = 'token'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()

    const row = [...root.querySelectorAll('[aria-labelledby="search-title"] li')].find((li) =>
      li.textContent!.includes('signs the token'),
    )!
    // Highlighting only the first suggests the rest does not match.
    expect(row.querySelectorAll('mark').length).toBeGreaterThanOrEqual(4)
  })
})

describe('filtering results by kind', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function type(value: string) {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const rows = () => [...root.querySelectorAll('[aria-labelledby="search-title"] .rows > li')]

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
    type('token')
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('offers only the kinds actually present in the results', () => {
    const filters = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')]
    expect(filters.length).toBeGreaterThan(1)

    const kinds = filters.map((b) => b.dataset.filter)
    expect(kinds).toContain('all')
    // No filter for a kind that would return nothing.
    for (const kind of kinds) {
      if (kind === 'all') continue
      expect(
        rows().some((li) => li.textContent!.length > 0),
        kind,
      ).toBe(true)
    }
  })

  /**
   * The counts carried by the filters were checked nowhere: two mutants
   * falsified them without the suite flinching. Yet they tell the user what
   * they will find on clicking.
   */
  it('carries the exact count of each kind, and their sum', () => {
    const found = searchTask(store.currentTask()!, 'token')
    const attendu = new Map<string, number>()
    for (const m of found) attendu.set(m.kind, (attendu.get(m.kind) ?? 0) + 1)

    const count = (bouton: HTMLButtonElement) =>
      Number(/\((\d+)\)\s*$/.exec(bouton.textContent!.trim())![1])

    for (const bouton of root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      const nature = bouton.dataset.filter!
      expect(count(bouton), nature).toBe(
        nature === 'all' ? found.length : (attendu.get(nature) ?? 0),
      )
    }

    // And "All" really is the sum of the others, not a number of its own.
    const parNature = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')]
      .filter((b) => b.dataset.filter !== 'all')
      .reduce((n, b) => n + count(b), 0)
    expect(parNature).toBe(found.length)
  })

  it('orders the kinds the way the log presents them', () => {
    // A rule comes before a step because that is the order of the log; an order
    // drawn from elsewhere would make the buttons dance from one keystroke to the next.
    const ordre = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')]
      .map((b) => b.dataset.filter!)
      .filter((k) => k !== 'all')
    const attendu = [...new Set(searchTask(store.currentTask()!, 'token').map((m) => m.kind))]
    expect(ordre).toEqual(attendu)
  })

  it('narrows down to the rows of the chosen kind', async () => {
    const before = rows().length
    const bouton = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')].find(
      (b) => b.dataset.filter === 'step',
    )!
    bouton.click()
    __renderNow()

    const after = rows().length
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(before)
    for (const li of rows()) {
      expect(li.textContent!.toUpperCase()).toContain('STEP')
    }
  })

  it('says which one is active, for the screen reader too', () => {
    const bouton = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')].find(
      (b) => b.dataset.filter === 'step',
    )!
    bouton.click()
    __renderNow()

    const actif = root.querySelector('[data-filter="step"]')!
    expect(actif.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('[data-filter="all"]')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('goes back to all, and the count in the title follows the filter', async () => {
    const all = rows().length
    root.querySelector<HTMLButtonElement>('[data-filter="step"]')!.click()
    __renderNow()
    const filtered = rows().length
    expect(root.querySelector('#search-title')!.textContent).toContain(String(filtered))

    root.querySelector<HTMLButtonElement>('[data-filter="all"]')!.click()
    __renderNow()
    expect(rows().length).toBe(all)
  })

  it('forgets the filter when the search changes', async () => {
    root.querySelector<HTMLButtonElement>('[data-filter="step"]')!.click()
    __renderNow()
    expect(root.querySelector('[data-filter="step"]')!.getAttribute('aria-pressed')).toBe('true')

    type('rotation')
    await settled()

    // A filter kept from one search to the next makes an empty result look real.
    const actif = root.querySelector('[data-filter="all"]')
    expect(actif?.getAttribute('aria-pressed')).toBe('true')
  })
})
