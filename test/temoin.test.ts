import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { getWitness, recordCall, resetCalls } from '../src/webmcp/witness'
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil, writeArgs, call } from './helpers'

describe('le témoin sait si l’agent a lu avant d’écrire', () => {
  beforeEach(resetCalls)

  it('ne prétend rien tant que rien n’a été appelé', () => {
    const { total, blindWrites, sawRead } = getWitness()
    expect(total).toBe(0)
    expect(blindWrites).toBe(0)
    expect(sawRead).toBe(false)
  })

  it('compte une écriture arrivée avant toute lecture', () => {
    recordCall('log_step', false)
    expect(getWitness().blindWrites).toBe(1)
    expect(getWitness().sawRead).toBe(false)
  })

  it('ne compte plus rien une fois que l’agent a lu', () => {
    recordCall('resume_task', false)
    recordCall('log_step', false)
    recordCall('add_decision', false)

    expect(getWitness().sawRead).toBe(true)
    expect(getWitness().blindWrites).toBe(0)
  })

  it('accepte what_changed et read_task_detail comme des lectures', () => {
    for (const tool of ['what_changed', 'read_task_detail', 'search_task']) {
      resetCalls()
      recordCall(tool, false)
      recordCall('log_step', false)
      expect(getWitness().blindWrites, tool).toBe(0)
    }
  })

  it('ne compte que les écritures qui ont abouti', () => {
    // A refused write recorded nothing: flagging it as "check what it wrote"
    // would send someone looking for something that does not exist. The
    // refusal itself already shows in the list of calls.
    recordCall('log_step', true)
    expect(getWitness().blindWrites).toBe(0)
    expect(getWitness().refused).toBe(1)

    recordCall('log_step', false)
    expect(getWitness().blindWrites).toBe(1)
  })

  it('ne tient pas une lecture refusée pour une lecture', () => {
    // A resume_task that failed taught the agent nothing.
    recordCall('resume_task', true)
    recordCall('log_step', false)
    expect(getWitness().blindWrites).toBe(1)
  })

  it('classe chaque outil livré comme lecture ou écriture, sans oubli', () => {
    for (const tool of ALL_TOOLS) {
      resetCalls()
      recordCall(tool.name, false)
      const attendu = READ_TOOLS.includes(tool)
      expect(getWitness().sawRead, tool.name).toBe(attendu)
      expect(WRITE_TOOLS.includes(tool), tool.name).toBe(!attendu)
    }
  })

  it('repart à zéro quand on efface le journal d’appels', () => {
    recordCall('log_step', false)
    resetCalls()
    expect(getWitness().blindWrites).toBe(0)
  })
})

describe('ce que la page en dit', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  const activity = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Activity'),
    )!

  beforeEach(async () => {
    resetCalls()
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
    resetCalls()
    history.replaceState(null, '', '/')
  })

  it('ne juge rien avant d’avoir observé quoi que ce soit', () => {
    expect(activity().textContent).not.toContain('without reading')
  })

  it('dit que l’agent a lu avant d’écrire, quand c’est le cas', async () => {
    const resume = ALL_TOOLS.find((t) => t.name === 'resume_task')!
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    await call(resume)
    await call(logStep, writeArgs(store.currentTask()!, { action: 'a', result: 'b' }))
    await settled()

    expect(activity().textContent).toContain('after reading this page')
  })

  it('signale une écriture arrivée sans lecture, qui contredit toute la promesse', async () => {
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    await call(logStep, writeArgs(store.currentTask()!, { action: 'a', result: 'b' }))
    await waitUntil(() => activity().textContent!.includes('without reading'), 'le constat')
    __renderNow()

    const text = activity().textContent!
    expect(text).toContain('1 write')
    expect(text).toContain('without reading')
  })
})
