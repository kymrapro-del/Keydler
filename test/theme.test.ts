import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import indexRaw from '../index.html?raw'
import tokensRaw from '../src/tokens.css?raw'
import vercelRaw from '../vercel.json?raw'
import { buildDemoTask } from '../src/demo/seed'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

describe('thème unique', () => {
  it('déclare le sombre dans le document, avant tout script', () => {
    const head = indexRaw.slice(0, indexRaw.indexOf('</head>'))
    expect(indexRaw).toMatch(/<html[^>]*data-theme="dark"/)
    expect(head).toContain('<meta name="theme-color" content="#131316" />')
    expect(head).not.toContain('prefers-color-scheme')
    expect(head).not.toContain('theme-init')
    expect(indexRaw.indexOf('data-theme="dark"')).toBeLessThan(indexRaw.indexOf('src/main.ts'))
  })

  it('ne sert plus de script d’amorçage de thème', () => {
    expect(indexRaw).not.toContain('theme-init.js')
  })

  it('reste compatible avec une CSP qui refuse les scripts inline', () => {
    expect(vercelRaw).toContain("script-src 'self'")
    expect(vercelRaw).not.toContain("'unsafe-inline'")
    expect(indexRaw).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })

  it('n’émet qu’un jeu de jetons sombres', () => {
    expect(tokensRaw).toContain('color-scheme: dark')
    expect(tokensRaw).not.toContain('@media (prefers-color-scheme')
    expect(tokensRaw).not.toContain("[data-theme='light']")
    expect(tokensRaw).not.toContain("[data-theme='dark']")
  })
})

describe('aucun sélecteur à l’écran', () => {
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
  })

  it('est absent de l’écran d’accueil', async () => {
    await settled()
    expect(root.querySelector('#toggle-theme')).toBeNull()
    expect(root.textContent).not.toMatch(/Theme:\s(system|light|dark)/)
  })

  it('est absent d’un cahier ouvert', async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
    expect(root.querySelector('#toggle-theme')).toBeNull()
    expect(root.textContent).not.toMatch(/Theme:\s(system|light|dark)/)
  })
})
