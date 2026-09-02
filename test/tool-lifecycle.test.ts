import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetRegistration,
  detectLifecycle,
  getRegistrationState,
  registerTools,
} from '../src/webmcp/register'
import { DYNAMIC_UNREGISTER_MIN_CHROMIUM } from '../src/webmcp/lifecycle'
import { ALL_TOOLS, READ_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { completeTask, reopenTask } from '../src/domain/task'
import {
  call,
  clearDatabase,
  installModelContext,
  pretendChromium,
  removeModelContext,
  resetUserAgentData,
  settle,
  textOf,
  writeArgs,
} from './helpers'

beforeEach(async () => {
  __resetRegistration()
  store.__resetStore()
  removeModelContext()
  resetUserAgentData()
  await clearDatabase()
})

afterEach(() => {
  __resetRegistration()
  removeModelContext()
  resetUserAgentData()
})

describe('capability detection', () => {
  it('allows dynamic removal only from Chromium 153 on', () => {
    pretendChromium(DYNAMIC_UNREGISTER_MIN_CHROMIUM)
    expect(detectLifecycle().mode).toBe('dynamic')

    pretendChromium(DYNAMIC_UNREGISTER_MIN_CHROMIUM + 7)
    expect(detectLifecycle().mode).toBe('dynamic')
  })

  it('stays static on the versions the contest targets', () => {
    for (const v of [149, 150, 151, 152]) {
      pretendChromium(v)
      const cycle = detectLifecycle()
      expect(cycle.mode, `Chromium ${v}`).toBe('static')
      expect(cycle.chromiumMajor).toBe(v)
    }
  })

  it('stays static when the version is unknown', () => {
    resetUserAgentData()
    const cycle = detectLifecycle()
    expect(cycle.mode).toBe('static')
    expect(cycle.chromiumMajor).toBeNull()
  })

  it('stays static outside Chromium, even on a recent browser', () => {
    pretendChromium(200, 'Firefox')
    const cycle = detectLifecycle()
    expect(cycle.mode).toBe('static')
    expect(cycle.chromiumMajor).toBeNull()
  })

  it('says what it rests on, since it cannot prove it', () => {
    pretendChromium(149)
    expect(detectLifecycle().reason).toMatch(/149/)
    resetUserAgentData()
    expect(detectLifecycle().reason).toMatch(/unknown|inconnu/i)
  })
})

describe('static mode: the contest target', () => {
  beforeEach(() => pretendChromium(151))

  it('registers the set matching the INITIAL state, and nothing more', async () => {
    const fake = installModelContext()
    await registerTools()

    expect(getRegistrationState().lifecycle.mode).toBe('static')
    expect(fake.names()).toEqual([
      'create_task',
      'read_task_detail',
      'resume_task',
      'search_task',
      'what_changed',
    ])
  })

  // The French said two, and the assertion has always expected four. Naming
  // what it checks rather than counting keeps the two from drifting again.
  it('registers only the read tools when loading a task that is already closed', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))

    store.__resetStore()
    await store.init(task.id)

    const fake = installModelContext()
    await registerTools()

    expect(fake.names()).toEqual([
      'create_task',
      'read_task_detail',
      'resume_task',
      'search_task',
      'what_changed',
    ])
  })

  it('NEVER removes a tool during the life of the document', async () => {
    const fake = installModelContext()
    const openTask = await store.createAndOpenTask('Task', 'Continue')
    await registerTools()
    expect(fake.names()).toContain('complete_task')

    const result = await fake.tools
      .get('complete_task')!
      .execute(writeArgs(openTask, { summary: 'Done, nothing remains.' }), {
        signal: new AbortController().signal,
      })
    await settle(8)

    expect(textOf(result)).toContain('OK: complete_task recorded.')
    expect(fake.names()).toHaveLength(ALL_TOOLS.length) // static mode withdraws nothing
    expect(getRegistrationState().toolNames).toHaveLength(ALL_TOOLS.length)
  })

  it('lets the writes refuse cleanly on a closed task', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Task', 'Continue')
    await registerTools()
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))
    await settle(4)

    const refusal = await fake.tools
      .get('log_step')!
      .execute(writeArgs(store.currentTask()!, { action: 'a', result: 'b' }), {
        signal: new AbortController().signal,
      })

    expect(refusal.isError).toBe(true)
    expect(textOf(refusal)).toContain('already completed')
    expect(textOf(refusal)).toContain('reopen')
    expect(textOf(await call(resumeTaskTool))).toContain('TASK CLOSED')
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('adds the writes instead when a task opens', async () => {
    const fake = installModelContext()
    await registerTools()
    expect(fake.names()).toHaveLength(READ_TOOLS.length + 1) // + create_task

    await store.createAndOpenTask('Task', 'Continue')
    await settle(4)

    expect(fake.names()).toHaveLength(ALL_TOOLS.length) // static mode withdraws nothing
    expect(fake.names()).toContain('log_step')
  })
})

describe('dynamic mode: Chromium 153 and beyond', () => {
  beforeEach(() => pretendChromium(DYNAMIC_UNREGISTER_MIN_CHROMIUM))

  it('removes the writes at closing', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Task', 'Continue')
    await registerTools()
    expect(getRegistrationState().lifecycle.mode).toBe('dynamic')

    await call(
      ALL_TOOLS.find((t) => t.name === 'complete_task')!,
      writeArgs(task, { summary: 'Done.' }),
    )
    await settle(6)

    expect(fake.names()).toEqual([
      'create_task',
      'read_task_detail',
      'resume_task',
      'search_task',
      'what_changed',
    ])
  })

  it('hands them back at reopening', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Task', 'Continue')
    await registerTools()
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))
    await settle(4)
    expect(fake.names()).toHaveLength(READ_TOOLS.length + 1) // + create_task

    await store.mutate((s) => reopenTask(s, 'Work remains'))
    await settle(4)

    expect(fake.names()).toHaveLength(ALL_TOOLS.length - 1) // create_task steps aside
    expect(store.currentTask()!.id).toBe(task.id)
  })
})
