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

describe('les raccourcis', () => {
  it('sont tous décrits, sans doublon de touche', () => {
    const keys = SHORTCUTS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.what, shortcut.key).toBeTruthy()
      expect(shortcut.key.length, shortcut.key).toBeLessThanOrEqual(6)
    }
  })

  it('ouvre l’aide sur « ? », et la referme sur Échap', () => {
    expect(root.querySelector('#shortcuts')).toBeNull()

    press('?')
    expect(root.querySelector('#shortcuts')).not.toBeNull()
    // Chaque raccourci annoncé est effectivement listé.
    for (const shortcut of SHORTCUTS) {
      expect(root.querySelector('#shortcuts')!.textContent, shortcut.key).toContain(shortcut.what)
    }

    press('Escape')
    expect(root.querySelector('#shortcuts')).toBeNull()
  })

  it('se referme aussi sur un second « ? »', () => {
    press('?')
    press('?')
    expect(root.querySelector('#shortcuts')).toBeNull()
  })

  it('ouvre le formulaire d’étape sur « s »', () => {
    press('s')
    expect(root.querySelector('#form-step')).not.toBeNull()
  })

  it('ouvre la création de tâche sur « n »', () => {
    press('n')
    expect(root.querySelector('#create-task')).not.toBeNull()
  })

  it('ne détourne aucune touche pendant que l’on écrit', () => {
    press('s')
    const field = root.querySelector<HTMLInputElement>('#step-action')!
    field.focus()

    const event = press('n', field)
    expect(event.defaultPrevented).toBe(false)
    expect(root.querySelector('#create-task')).toBeNull()
  })

  it('laisse passer une combinaison du navigateur', () => {
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

describe('l’impression', () => {
  it('a sa feuille, pour qu’une passation sur papier reste lisible', () => {
    expect(css).toMatch(/@media\s+print/)
  })

  it('retire de la page imprimée ce qui ne s’imprime pas', () => {
    const bloc = css.slice(css.search(/@media\s+print/))
    // Des boutons sur une feuille de papier ne servent à personne, et le
    // fond sombre vide une cartouche.
    expect(bloc).toContain('.btn')
    expect(bloc).toContain('display: none')
  })
})
