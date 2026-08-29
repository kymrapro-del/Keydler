import { beforeEach, describe, expect, it } from 'vitest'
import { resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { taskIdFromPath, taskPath } from '../src/webmcp/location'
import { call, clearDatabase, textOf } from './helpers'

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('the URL', () => {
  it('reads an id from /t/:id, and nothing else', () => {
    expect(taskIdFromPath('/t/abc123')).toBe('abc123')
    expect(taskIdFromPath('/t/abc123/quoi')).toBe('abc123')
    expect(taskIdFromPath('/')).toBeNull()
    expect(taskIdFromPath('/tasks/abc')).toBeNull()
    expect(taskIdFromPath('/t/')).toBeNull()
  })

  it('rejects what is not an id: a path is untrusted input', () => {
    expect(taskIdFromPath('/t/../../etc')).toBeNull()
    expect(taskIdFromPath('/t/<script>')).toBeNull()
    expect(taskIdFromPath('/t/' + 'x'.repeat(65))).toBeNull()
  })

  it('makes the round trip', () => {
    expect(taskIdFromPath(taskPath('abc123def456'))).toBe('abc123def456')
  })
})

describe('bound resume', () => {
  it('gives back the task the URL names, not the last one touched', async () => {
    const first = await store.createAndOpenTask('First task', 'A')
    const second = await store.createAndOpenTask('Second task', 'B')
    expect(second.id).not.toBe(first.id)

    store.__resetStore()
    await store.init(first.id)

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('First task')
    expect(rendered).not.toContain('Second task')
    expect(rendered).toContain(`TASK ID     ${first.id}`)
  })

  it('names the task in every answer, so a substitution shows', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain(`TASK ID     ${task.id}`)
    expect(resumeTaskTool.description).toContain('TASK ID')
  })

  it('refuses rather than substituting when the bound notebook is gone', async () => {
    const first = await store.createAndOpenTask('First task', 'A')
    await store.createAndOpenTask('Second task', 'B')

    store.__resetStore()
    await store.init(first.id)
    await store.deleteCurrentTask()

    store.__resetStore()
    await store.init(first.id)

    const result = await call(resumeTaskTool)
    expect(result.isError).toBe(true)
    const rendered = textOf(result)
    expect(rendered).toContain('TASK NOT FOUND')
    expect(rendered).toContain(first.id)
    expect(rendered).toContain('has not')
    expect(rendered).not.toContain('Second task')
  })

  it('refuses every write on a vanished bound notebook too', async () => {
    const { ALL_TOOLS } = await import('../src/webmcp/tools')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    const task = await store.createAndOpenTask('Task', 'Continue')
    store.__resetStore()
    await store.init('missing-123')

    const result = await call(logStep, {
      action: 'a',
      result: 'b',
      based_on_version: task.version,
      mutation_id: 'aaaaaaaa-bbbb',
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('TASK NOT FOUND')
  })

  it('binds to the last opened notebook when the URL says nothing', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    store.__resetStore()
    await store.init()

    expect(store.boundTaskId()).toBe(task.id)
    expect(textOf(await call(resumeTaskTool))).toContain(`TASK ID     ${task.id}`)
  })

  it('tells “no notebook” apart from “that notebook is gone”', async () => {
    store.__resetStore()
    await store.init()
    expect(textOf(await call(resumeTaskTool))).toContain('NO ACTIVE TASK')

    store.__resetStore()
    await store.init('never-existed')
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('TASK NOT FOUND')
    expect(rendered).not.toContain('NO ACTIVE TASK')
  })
})
