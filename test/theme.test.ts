import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import indexRaw from '../index.html?raw'
import { applyTheme, nextTheme, readTheme, themeLabel } from '../src/ui/theme'
import { buildDemoTask } from '../src/demo/seed'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('theme choice', () => {
  it('starts from the system, and cycles through three states', () => {
    expect(readTheme()).toBe('system')
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('marks the root only when the choice is explicit', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('remembers the choice, and forgets the return to system', () => {
    applyTheme('dark')
    expect(readTheme()).toBe('dark')

    applyTheme('system')
    expect(readTheme()).toBe('system')
    expect(localStorage.getItem('watch-log.theme')).toBeNull()
  })

  it('survives refused storage without breaking the page', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('denied')
    }

    // Private browsing, site data blocked: the choice holds for this page, and
    // nothing must fall over.
    expect(() => applyTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')

    Storage.prototype.setItem = real
  })

  it('keeps the browser bar color current', () => {
    applyTheme('dark')
    const dark = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    expect(dark!.content).toBe('#10140d')

    applyTheme('light')
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    // Only one: stacking the tags would leave the browser to choose.
    expect(metas).toHaveLength(1)
    expect((metas[0] as HTMLMetaElement).content).toBe('#f4f6ee')
  })

  it('names the state in plain words', () => {
    expect(themeLabel('system')).toBe('Theme: system')
    expect(themeLabel('dark')).toBe('Theme: dark')
  })
})

describe('no flash on load', () => {
  it('reads the choice before the first paint, in the document itself', () => {
    // Reading it from the module would run after the first render: the page
    // would show for a fraction of a second in the system theme.
    const head = indexRaw.slice(0, indexRaw.indexOf('</head>'))
    expect(head).toContain("localStorage.getItem('watch-log.theme')")
    expect(head).toContain('document.documentElement.dataset.theme')
    expect(head.indexOf('watch-log.theme')).toBeLessThan(indexRaw.indexOf('src/main.ts'))
  })
})

describe('the toggle on screen', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 6) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
  })

  afterEach(() => {
    unmount()
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('is reachable from the first screen', async () => {
    await settled()
    const button = root.querySelector<HTMLButtonElement>('#toggle-theme')!
    expect(button.textContent).toContain('Theme: system')
  })

  it('switches on click, and announces it', async () => {
    await settled()
    root.querySelector<HTMLButtonElement>('#toggle-theme')!.click()
    await settled()

    expect(document.documentElement.dataset.theme).toBe('light')
    const button = root.querySelector<HTMLButtonElement>('#toggle-theme')!
    expect(button.textContent).toContain('Theme: light')
    expect(button.getAttribute('aria-label')).toContain('Click to switch')
    expect(document.activeElement).toBe(button)
  })

  it('stays reachable from an open task', async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
    expect(root.querySelector('#toggle-theme')).not.toBeNull()
  })
})
