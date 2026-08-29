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
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
  await store.openPreparedTask(buildCoreTask())
  await settled()
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

describe('seeing what an agent reads, without an agent', () => {
  it('stays collapsed: it is not what you look at first', () => {
    expect(inspector()).not.toBeNull()
    expect(inspector()!.hasAttribute('open')).toBe(false)
  })

  it('lists every tool shipped, and no more', () => {
    const names = [...inspector()!.querySelectorAll('[data-tool]')].map((n) =>
      n.getAttribute('data-tool'),
    )
    expect(names.sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort())
  })

  it('says which ones read and which ones write', () => {
    for (const tool of ALL_TOOLS) {
      const toolBlock = inspector()!.querySelector(`[data-tool="${tool.name}"]`)!
      const expected = READ_TOOLS.includes(tool) ? 'reads' : 'writes'
      expect(toolBlock.textContent!.toLowerCase(), tool.name).toContain(expected)
    }
  })

  it('shows the exact description the agent receives, not a summary', () => {
    for (const tool of ALL_TOOLS) {
      const toolBlock = inspector()!.querySelector(`[data-tool="${tool.name}"]`)!
      expect(toolBlock.textContent, tool.name).toContain(tool.description)
    }
  })

  it('shows the input schema exactly as declared', () => {
    const logStep = inspector()!.querySelector('[data-tool="log_step"]')!
    const schema = logStep.querySelectorAll('pre')[1]!.textContent!
    expect(JSON.parse(schema)).toEqual(ALL_TOOLS.find((t) => t.name === 'log_step')!.inputSchema)
  })

  it('injects no markup coming from a description', () => {
    expect(inspector()!.querySelector('script')).toBeNull()
    expect(inspector()!.innerHTML).not.toContain('<script')
  })

  it('says where the list comes from: the objects actually registered', () => {
    expect(inspector()!.textContent!.toLowerCase()).toContain('registered')
  })
})
