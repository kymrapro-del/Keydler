import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { ALL_TOOLS, READ_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

let root: HTMLElement
let unmount: () => void

async function settled(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

const inspector = () => root.querySelector('#tools')

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
  await store.openPreparedTask(buildCoreTask())
  await settled()
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

describe('voir ce qu’un agent lit, sans agent', () => {
  it('reste replié : ce n’est pas ce qu’on regarde d’abord', () => {
    expect(inspector()).not.toBeNull()
    expect(inspector()!.hasAttribute('open')).toBe(false)
  })

  it('liste chaque outil livré, aucun de plus', () => {
    const noms = [...inspector()!.querySelectorAll('[data-tool]')].map((n) =>
      n.getAttribute('data-tool'),
    )
    expect(noms.sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort())
  })

  it('dit lesquels lisent et lesquels écrivent', () => {
    for (const tool of ALL_TOOLS) {
      const bloc = inspector()!.querySelector(`[data-tool="${tool.name}"]`)!
      const attendu = READ_TOOLS.includes(tool) ? 'reads' : 'writes'
      expect(bloc.textContent!.toLowerCase(), tool.name).toContain(attendu)
    }
  })

  it('montre la description exacte que l’agent reçoit, pas un résumé', () => {
    for (const tool of ALL_TOOLS) {
      const bloc = inspector()!.querySelector(`[data-tool="${tool.name}"]`)!
      expect(bloc.textContent, tool.name).toContain(tool.description)
    }
  })

  it('montre le schéma d’entrée tel qu’il est déclaré', () => {
    const logStep = inspector()!.querySelector('[data-tool="log_step"]')!
    const schema = logStep.querySelectorAll('pre')[1]!.textContent!
    expect(JSON.parse(schema)).toEqual(ALL_TOOLS.find((t) => t.name === 'log_step')!.inputSchema)
  })

  it('n’injecte aucun balisage venu d’une description', () => {
    expect(inspector()!.querySelector('script')).toBeNull()
    expect(inspector()!.innerHTML).not.toContain('<script')
  })

  it('dit d’où vient la liste : les objets réellement enregistrés', () => {
    expect(inspector()!.textContent!.toLowerCase()).toContain('registered')
  })
})
