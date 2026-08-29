import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { SHORTCUTS } from '../src/ui/shortcuts'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

const css = Object.values(
  import.meta.glob('../src/style.css', { eager: true, query: '?raw', import: 'default' }),
)[0] as string

let root: HTMLElement
let unmount: () => void

async function settled(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

function press(key: string, from: Element = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  from.dispatchEvent(event)
  __renderNow()
  return event
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
  history.replaceState(null, '', '/')
})

describe('the shortcuts', () => {
  it('are all described, with no duplicate key', () => {
    const keys = SHORTCUTS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.what, shortcut.key).toBeTruthy()
      expect(shortcut.key.length, shortcut.key).toBeLessThanOrEqual(6)
    }
  })

  it('opens the help on `?`, and closes it on Escape', () => {
    expect(root.querySelector('#shortcuts')).toBeNull()

    press('?')
    expect(root.querySelector('#shortcuts')).not.toBeNull()
    // Every announced shortcut is actually listed.
    for (const shortcut of SHORTCUTS) {
      expect(root.querySelector('#shortcuts')!.textContent, shortcut.key).toContain(shortcut.what)
    }

    press('Escape')
    expect(root.querySelector('#shortcuts')).toBeNull()
  })

  it('closes again on a second `?`', () => {
    press('?')
    press('?')
    expect(root.querySelector('#shortcuts')).toBeNull()
  })

  it('opens the step form on `s`', () => {
    press('s')
    expect(root.querySelector('#form-step')).not.toBeNull()
  })

  it('opens task creation on `n`', () => {
    press('n')
    expect(root.querySelector('#create-task')).not.toBeNull()
  })

  it('hijacks no key while you are typing', () => {
    press('s')
    const field = root.querySelector<HTMLInputElement>('#step-action')!
    field.focus()

    const event = press('n', field)
    expect(event.defaultPrevented).toBe(false)
    expect(root.querySelector('#create-task')).toBeNull()
  })

  it('lets a browser combination through', () => {
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(event)
    __renderNow()

    expect(event.defaultPrevented).toBe(false)
    expect(root.querySelector('#form-step')).toBeNull()
  })
})

describe('printing', () => {
  it('has its own sheet, so that a handover on paper stays readable', () => {
    expect(css).toMatch(/@media\s+print/)
  })

  it('takes off the printed page what does not print', () => {
    const bloc = css.slice(css.search(/@media\s+print/))
    // Buttons on a sheet of paper are of use to nobody, and the dark background
    // empties a cartridge.
    expect(bloc).toContain('.btn')
    expect(bloc).toContain('display: none')
  })
})
