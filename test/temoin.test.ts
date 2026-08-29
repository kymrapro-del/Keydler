import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { getWitness, recordCall, resetCalls } from '../src/webmcp/witness'
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil, writeArgs, call } from './helpers'

describe('the witness knows whether the agent read before writing', () => {
  beforeEach(resetCalls)

  it('claims nothing until something has been called', () => {
    const { total, blindWrites, sawRead } = getWitness()
    expect(total).toBe(0)
    expect(blindWrites).toBe(0)
    expect(sawRead).toBe(false)
  })

  it('counts a write that arrived before any read', () => {
    recordCall('log_step', false)
    expect(getWitness().blindWrites).toBe(1)
    expect(getWitness().sawRead).toBe(false)
  })

  it('counts nothing more once the agent has read', () => {
    recordCall('resume_task', false)
    recordCall('log_step', false)
    recordCall('add_decision', false)

    expect(getWitness().sawRead).toBe(true)
    expect(getWitness().blindWrites).toBe(0)
  })

  it('accepts what_changed and read_task_detail as reads', () => {
    for (const tool of ['what_changed', 'read_task_detail', 'search_task']) {
      resetCalls()
      recordCall(tool, false)
      recordCall('log_step', false)
      expect(getWitness().blindWrites, tool).toBe(0)
    }
  })

  it('counts only the writes that went through', () => {
    // A refused write recorded nothing: flagging it as "check what it wrote"
    // would send someone looking for something that does not exist. The refusal
    // itself already shows in the list of calls.
    recordCall('log_step', true)
    expect(getWitness().blindWrites).toBe(0)
    expect(getWitness().refused).toBe(1)

    recordCall('log_step', false)
    expect(getWitness().blindWrites).toBe(1)
  })

  it('does not take a refused read for a read', () => {
    // A resume_task that failed taught the agent nothing.
    recordCall('resume_task', true)
    recordCall('log_step', false)
    expect(getWitness().blindWrites).toBe(1)
  })

  it('classes every shipped tool as a read or a write, with none left out', () => {
    for (const tool of ALL_TOOLS) {
      resetCalls()
      recordCall(tool.name, false)
      const attendu = READ_TOOLS.includes(tool)
      expect(getWitness().sawRead, tool.name).toBe(attendu)
      expect(WRITE_TOOLS.includes(tool), tool.name).toBe(!attendu)
    }
  })

  it('starts over from zero when the call log is cleared', () => {
    recordCall('log_step', false)
    resetCalls()
    expect(getWitness().blindWrites).toBe(0)
  })
})

describe('what the page says about it', () => {
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

  it('judges nothing before it has observed anything', () => {
    expect(activity().textContent).not.toContain('without reading')
  })

  it('says the agent read before writing, when that is the case', async () => {
    const resume = ALL_TOOLS.find((t) => t.name === 'resume_task')!
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    await call(resume)
    await call(logStep, writeArgs(store.currentTask()!, { action: 'a', result: 'b' }))
    await settled()

    expect(activity().textContent).toContain('after reading this page')
  })

  it('flags a write that arrived without a read, which contradicts the whole promise', async () => {
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    await call(logStep, writeArgs(store.currentTask()!, { action: 'a', result: 'b' }))
    await waitUntil(() => activity().textContent!.includes('without reading'), 'the observation')
    __renderNow()

    const text = activity().textContent!
    expect(text).toContain('1 write')
    expect(text).toContain('without reading')
  })
})
