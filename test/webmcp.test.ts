import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import {
  __resetRegistration,
  getRegistrationState,
  registerTools,
  toolsForCurrentState,
} from '../src/webmcp/register'
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { checkAvailability } from '../src/webmcp/adapter'
import {
  call,
  clearDatabase,
  installModelContext,
  mutationId,
  removeModelContext,
  settle,
  textOf,
  writeArgs,
} from './helpers'

beforeEach(async () => {
  __resetRegistration()
  store.__resetStore()
  removeModelContext()
  await clearDatabase()
})

afterEach(() => {
  __resetRegistration()
  removeModelContext()
})

describe('inventory', () => {
  it('exposes four read tools and nine write tools', () => {
    expect(READ_TOOLS.map((t) => t.name)).toEqual([
      'resume_task',
      'what_changed',
      'read_task_detail',
      'search_task',
    ])
    expect(WRITE_TOOLS.map((t) => t.name)).toEqual([
      'log_step',
      'attach_evidence',
      'set_next_action',
      'add_constraint',
      'reject_approach',
      'add_decision',
      'ask_human',
      'request_approval',
      'complete_task',
    ])
    expect(ALL_TOOLS).toHaveLength(13)
  })

  it('never announces an annotation WebMCP does not carry', () => {
    const connues = new Set(['readOnlyHint', 'untrustedContentHint'])
    for (const tool of ALL_TOOLS) {
      for (const key of Object.keys(tool.annotations ?? {})) {
        expect(connues).toContain(key)
      }
    }
  })

  it('marks reads read-only and their content untrusted', () => {
    for (const tool of READ_TOOLS) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool.annotations?.untrustedContentHint).toBe(true)
    }
    for (const tool of WRITE_TOOLS) {
      expect(tool.annotations?.readOnlyHint).toBe(false)
    }
  })

  it('describes resume_task by saying when to call it', () => {
    const description = resumeTaskTool.description
    expect(description).toContain('BEFORE doing any work')
    expect(description).toContain('context loss')
    expect(description).toContain('refused as stale')
    expect(resumeTaskTool.annotations?.readOnlyHint).toBe(true)
  })
})

describe('availability', () => {
  it('tells an insecure context apart from a missing API', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })

    expect(checkAvailability()).toEqual({ supported: false, reason: 'insecure-context' })
    const state = await registerTools()
    expect(state.phase).toBe('unsupported')

    if (original) Object.defineProperty(window, 'isSecureContext', original)
    else Reflect.deleteProperty(window, 'isSecureContext')
  })

  it('reports a missing API without throwing', async () => {
    const state = await registerTools()
    expect(state.phase).toBe('unsupported')
    expect(state.toolNames).toEqual([])
    expect(checkAvailability()).toEqual({ supported: false, reason: 'no-api' })
  })

  it('still accepts navigator.modelContext, deprecated since Chrome 150', async () => {
    const registered: Array<{ name: string }> = []
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool: async (tool: { name: string }) => {
          registered.push(tool)
        },
      },
    })

    const state = await registerTools()
    expect(state.phase).toBe('registered')
    expect(state.availability).toEqual({ supported: true, surface: 'navigator' })
    expect(registered.map((t) => t.name)).toEqual([
      'resume_task',
      'what_changed',
      'read_task_detail',
      'search_task',
    ])

    Reflect.deleteProperty(navigator, 'modelContext')
  })
})

describe('tools end to end', () => {
  it('renders a readable state and then refuses a stale write', async () => {
    const task = await store.createAndOpenTask('Refactor authentication', 'Map the system')

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('Refactor authentication')
    expect(rendered).toContain(`VERSION     ${task.version}`)
    expect(rendered).toContain(`TASK ID     ${task.id}`)

    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const ok = await call(
      logStep,
      writeArgs(task, { action: 'Read the module', result: 'three entries' }),
    )
    expect(ok.isError).toBeUndefined()
    expect(textOf(ok)).toContain('OK: log_step recorded.')

    const stale = await call(logStep, writeArgs(task, { action: 'Again', result: 'failed' }))
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toContain('STALE STATE')
    expect(textOf(stale)).toContain('what_changed')
    expect(textOf(stale)).toContain('resume_task')

    const current = store.currentTask()!
    expect(current.audit.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
  })

  it('requires a reason to reject, and says so to the agent', async () => {
    const task = await store.createAndOpenTask('Task', 'Prochaine')
    const rejectApproach = ALL_TOOLS.find((t) => t.name === 'reject_approach')!

    const result = await call(
      rejectApproach,
      writeArgs(task, { approach: 'JWT variante B', reason: '' }),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('INVALID INPUT')
    expect(textOf(result)).toContain('reason')
  })

  it('refuses a mutation_id that could not serve a replay', async () => {
    const task = await store.createAndOpenTask('Task', 'Prochaine')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    for (const invalid of ['', 'short', 'value with spaces here', 'x'.repeat(65)]) {
      const result = await call(logStep, {
        action: 'a',
        result: 'b',
        based_on_version: task.version,
        mutation_id: invalid,
      })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('mutation_id')
    }
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('says plainly there is no task rather than failing', async () => {
    expect(textOf(await call(resumeTaskTool))).toContain('NO ACTIVE TASK')
  })
})

describe('tool lifecycle', () => {
  it('exposes no write while no task is open', async () => {
    const fake = installModelContext()
    await registerTools()

    expect(fake.names()).toEqual(['read_task_detail', 'resume_task', 'search_task', 'what_changed'])
    expect(toolsForCurrentState().map((t) => t.name)).toEqual([
      'resume_task',
      'what_changed',
      'read_task_detail',
      'search_task',
    ])
  })

  it('exposes the writes as soon as a task is open, and emits toolchange', async () => {
    const fake = installModelContext()
    await registerTools()

    const changements: string[][] = []
    fake.addEventListener('toolchange', () => {
      void fake.getTools().then((t) => changements.push(t.map((x) => x.name)))
    })

    await store.createAndOpenTask('Task', 'Continue')
    await settle()

    expect(fake.names()).toEqual([
      'add_constraint',
      'add_decision',
      'ask_human',
      'attach_evidence',
      'complete_task',
      'log_step',
      'read_task_detail',
      'reject_approach',
      'request_approval',
      'resume_task',
      'search_task',
      'set_next_action',
      'what_changed',
    ])

    expect(changements.length).toBeGreaterThan(0)
    expect(changements.at(-1)).toContain('log_step')

    const snapshotState = await registerTools()
    expect(snapshotState.observedTools).not.toBeNull()
    expect(snapshotState.observedTools).toContain('log_step')
  })

  it('keeps the writes in place at closing, for lack of a removal guarantee', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Task', 'Continue')
    await registerTools()
    expect(fake.names()).toContain('log_step')

    const complete = ALL_TOOLS.find((t) => t.name === 'complete_task')!
    const outcome = await call(complete, writeArgs(task, { summary: 'Done, nothing remains.' }))
    await settle(6)

    expect(getRegistrationState().lifecycle.mode).toBe('static')
    expect(fake.names()).toHaveLength(ALL_TOOLS.length)

    expect(textOf(outcome)).toContain('OK: complete_task recorded.')
    expect(textOf(await call(resumeTaskTool))).toContain('TASK CLOSED')
  })

  it('unregisters through AbortController, never re-registering a taken name', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Task', 'Continue')
    await registerTools()

    const before = [...fake.attempts]
    await store.mutate((s) => ({ ...s, updatedAt: s.updatedAt + 1 }))
    await settle()

    expect(fake.attempts).toEqual(before)
    expect(fake.names()).toContain('log_step')
  })

  it('keeps the registered tools when a single one fails', async () => {
    const fake = installModelContext()
    fake.failOn.add('reject_approach')
    await store.createAndOpenTask('Task', 'Continue')

    const snapshotState = await registerTools()

    expect(snapshotState.phase).toBe('partial')
    expect(snapshotState.toolNames).toContain('resume_task')
    expect(snapshotState.toolNames).toContain('log_step')
    expect(snapshotState.toolNames).not.toContain('reject_approach')
    expect(snapshotState.failures.map((f) => f.name)).toEqual(['reject_approach'])
    expect(snapshotState.error).toContain('reject_approach')

    expect(fake.names()).toEqual([...snapshotState.toolNames].sort())
  })

  it('keeps announcing the missing tool, even when a round has nothing to place', async () => {
    const fake = installModelContext()
    fake.failOn.add('reject_approach')
    await store.createAndOpenTask('Task', 'Continue')
    await registerTools()

    await store.mutate((s) => ({ ...s, updatedAt: s.updatedAt + 1 }))
    await settle()

    const { getRegistrationState } = await import('../src/webmcp/register')
    const snapshotState = getRegistrationState()
    expect(snapshotState.phase).toBe('partial')
    expect(snapshotState.failures.map((f) => f.name)).toEqual(['reject_approach'])
    expect(fake.names()).not.toContain('reject_approach')
  })

  it('puts back a tool whose failure was temporary', async () => {
    const fake = installModelContext()
    fake.failOn.add('reject_approach')
    await store.createAndOpenTask('Task', 'Continue')
    await registerTools()
    expect(fake.names()).not.toContain('reject_approach')

    fake.failOn.delete('reject_approach')
    await store.mutate((s) => ({ ...s, updatedAt: s.updatedAt + 1 }))
    await settle()

    const { getRegistrationState } = await import('../src/webmcp/register')
    expect(fake.names()).toContain('reject_approach')
    expect(getRegistrationState().phase).toBe('registered')
  })

  it('never places the same name twice, even when two rounds overlap', async () => {
    const fake = installModelContext()
    await registerTools()

    fake.slow = true
    await store.createAndOpenTask('One', 'A')
    await store.openPreparedTask({ ...store.currentTask()!, updatedAt: Date.now() + 1 })
    await settle(2)

    fake.slow = false
    fake.resume()
    await settle(8)

    const doublons = fake.attempts.filter((n, i) => fake.attempts.indexOf(n) !== i)
    expect(doublons).toEqual([])

    const { getRegistrationState } = await import('../src/webmcp/register')
    expect(getRegistrationState().phase).toBe('registered')
    expect(fake.names()).toContain('log_step')
  })

  it('never registers twice, even when called twice', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Task', 'Continue')

    const first = await registerTools()
    const second = await registerTools()

    expect(first.phase).toBe('registered')
    expect(second.phase).toBe('registered')
    expect(fake.attempts).toHaveLength(ALL_TOOLS.length)
  })

  it('rejects a registration whose signal is already aborted', async () => {
    const fake = installModelContext()
    const controller = new AbortController()
    controller.abort()

    await expect(
      fake.registerTool({ ...resumeTaskTool }, { signal: controller.signal }),
    ).rejects.toThrow()
    expect(fake.names()).toEqual([])
  })
})

describe('cancellation', () => {
  it('writes nothing when the signal is already aborted', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    const controller = new AbortController()
    controller.abort()

    const result = await call(
      logStep,
      writeArgs(task, { action: 'a', result: 'b' }),
      controller.signal,
    )

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CANCELLED')
    expect(store.currentTask()!.steps).toHaveLength(0)
    expect(store.currentTask()!.version).toBe(task.version)
  })

  it('writes nothing either when the cancellation lands while waiting in the queue', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const controller = new AbortController()

    const firstOne = call(logStep, writeArgs(task, { action: 'first', result: 'ok' }))
    const second = call(
      logStep,
      {
        action: 'second',
        result: 'ko',
        based_on_version: task.version + 1,
        mutation_id: mutationId(),
      },
      controller.signal,
    )
    controller.abort()

    await firstOne
    const result = await second

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CANCELLED')

    const final = store.currentTask()!
    expect(final.steps.map((s) => s.action)).toEqual(['first'])
    expect(final.version).toBe(task.version + 1)

    const last = final.audit.at(-1)!
    expect(last.outcome).toBe('refused')
    expect(last.operation).toBe('log_step')
    expect(last.detail).toContain('cancelled')
    expect(last.versionBefore).toBe(last.versionAfter)
  })

  it('leaves a trace of the refusal, so the screen can show it', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const controller = new AbortController()
    controller.abort()

    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }), controller.signal)

    const auditLog = store.currentTask()!.audit
    expect(auditLog.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
  })

  it('refuses a cancelled read too rather than serving it', async () => {
    await store.createAndOpenTask('Task', 'Continue')
    const controller = new AbortController()
    controller.abort()

    const result = await call(resumeTaskTool, {}, controller.signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CANCELLED')
  })
})
