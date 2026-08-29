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

describe('choix du thème', () => {
  it('part du système, et tourne en trois états', () => {
    expect(readTheme()).toBe('system')
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('marque la racine seulement quand le choix est explicite', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('se souvient du choix, et oublie le retour au système', () => {
    applyTheme('dark')
    expect(readTheme()).toBe('dark')

    applyTheme('system')
    expect(readTheme()).toBe('system')
    expect(localStorage.getItem('watch-log.theme')).toBeNull()
  })

  it('survit à un stockage refusé sans casser la page', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('denied')
    }

    // Private browsing, site data blocked: the choice holds for this
    // page, and nothing must fall over.
    expect(() => applyTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')

    Storage.prototype.setItem = real
  })

  it('tient la couleur de la barre du navigateur à jour', () => {
    applyTheme('dark')
    const dark = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    expect(dark!.content).toBe('#131316')

    applyTheme('light')
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    // Only one: stacking the tags would leave the browser to choose.
    expect(metas).toHaveLength(1)
    expect((metas[0] as HTMLMetaElement).content).toBe('#ffffff')
  })

  it('nomme l’état en clair', () => {
    expect(themeLabel('system')).toBe('Theme: system')
    expect(themeLabel('dark')).toBe('Theme: dark')
  })
})

describe('sans flash au chargement', () => {
  it('lit le choix avant la première peinture, dans le document lui-même', () => {
    // Reading it from the module would run after the first render: the page
    // would show for a fraction of a second in the system theme.
    const head = indexRaw.slice(0, indexRaw.indexOf('</head>'))
    expect(head).toContain("localStorage.getItem('watch-log.theme')")
    expect(head).toContain('document.documentElement.dataset.theme')
    expect(head.indexOf('watch-log.theme')).toBeLessThan(indexRaw.indexOf('src/main.ts'))
  })
})

describe('la bascule à l’écran', () => {
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
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
  })

  afterEach(() => {
    unmount()
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('est joignable dès le premier écran', async () => {
    await settled()
    const button = root.querySelector<HTMLButtonElement>('#toggle-theme')!
    expect(button.textContent).toContain('Theme: system')
  })

  it('bascule au clic, et l’annonce', async () => {
    await settled()
    root.querySelector<HTMLButtonElement>('#toggle-theme')!.click()
    await settled()

    expect(document.documentElement.dataset.theme).toBe('light')
    const button = root.querySelector<HTMLButtonElement>('#toggle-theme')!
    expect(button.textContent).toContain('Theme: light')
    expect(button.getAttribute('aria-label')).toContain('Click to switch')
    expect(document.activeElement).toBe(button)
  })

  it('reste joignable depuis un cahier ouvert', async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
    expect(root.querySelector('#toggle-theme')).not.toBeNull()
  })
})
