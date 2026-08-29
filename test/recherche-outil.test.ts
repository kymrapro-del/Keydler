import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, logStep, rejectApproach } from '../src/domain/task'
import { renderSearch } from '../src/domain/searchResult'
import { searchTaskTool } from '../src/webmcp/tools'
import { READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { addSecret } from '../src/persistence/vault'
import { call, clearDatabase, currentTask, textOf } from './helpers'

async function seed() {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  await store.openPreparedTask(buildDemoTask())
}

describe('search_task', () => {
  beforeEach(seed)
  afterEach(() => {
    store.__resetStore()
  })

  it('is declared read-only, and announced as such', () => {
    expect(searchTaskTool.annotations?.readOnlyHint).toBe(true)
    expect(searchTaskTool.annotations?.untrustedContentHint).toBe(true)
    expect(READ_TOOLS).toContain(searchTaskTool)
    expect(WRITE_TOOLS).not.toContain(searchTaskTool)
  })

  it('answers the product question: has this been tried already?', async () => {
    await store.mutate((s) =>
      rejectApproach(
        s,
        {
          approach: 'Caching tokens in localStorage',
          reason: 'XSS reads it',
          basedOnVersion: null,
        },
        'human',
      ),
    )

    const found = textOf(await call(searchTaskTool, { query: 'localStorage' }))
    expect(found).toContain('Caching tokens in localStorage')
    expect(found).toContain('XSS reads it')
    expect(found).toMatch(/RULED OUT|Ruled out/)
  })

  it('searches the steps, the evidence, the rules and the decisions', async () => {
    await store.mutate((s) =>
      logStep(
        s,
        {
          action: 'Ran the suite',
          result: 'green',
          evidence: { kind: 'test_report', content: 'monogram-parser 41 passed' },
          basedOnVersion: null,
        },
        'human',
      ),
    )
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Never touch monogram-parser', basedOnVersion: null }, 'human'),
    )

    const found = textOf(await call(searchTaskTool, { query: 'monogram-parser' }))
    expect(found).toContain('Never touch monogram-parser')
    // The evidence counts: it is often where the trace of an attempt sits.
    expect(found).toContain('Ran the suite')
  })

  it('says plainly that it found nothing, without implying there is no trace', async () => {
    const found = textOf(await call(searchTaskTool, { query: 'quantum-flux-capacitor' }))
    expect(found).toContain('NO MATCH')
    expect(found).toContain('quantum-flux-capacitor')
    // An empty search does not prove nothing was tried: the log may simply use
    // other words.
    expect(found.toLowerCase()).toContain('does not prove')
  })

  it('refuses a query that is too short rather than dumping everything', async () => {
    const result = await call(searchTaskTool, { query: 'a' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('query')
  })

  it('bounds its answer, and says how many results it left out', async () => {
    for (let i = 0; i < 30; i++) {
      await store.mutate((s) =>
        addConstraint(s, { rule: `Rule about widgets number ${i}`, basedOnVersion: null }, 'human'),
      )
    }

    const found = textOf(await call(searchTaskTool, { query: 'widgets' }))
    expect(found).toContain('30')
    expect(found).toMatch(/more not shown|MORE/)
    expect(found.length).toBeLessThan(6000)
  })

  it('never returns the value of a credential', async () => {
    const task = currentTask()
    await addSecret({
      taskId: task.id,
      name: 'gemini-api-key',
      purpose: 'Gemini calls',
      value: 'AIzaSy-never-leaves-this-device',
      passphrase: 'correct horse battery',
    })
    await store.mutate((s) =>
      logStep(
        s,
        {
          action: 'Called Gemini with ${gemini-api-key}',
          result: 'ok',
          basedOnVersion: null,
        },
        'human',
      ),
    )

    const found = textOf(await call(searchTaskTool, { query: 'gemini' }))
    expect(found).not.toContain('AIzaSy-never-leaves-this-device')
  })

  it('refuses an out-of-range limit rather than clamping it silently', async () => {
    for (const limit of [0, 99, 2.5, 'beaucoup']) {
      const result = await call(searchTaskTool, { query: 'token', limit })
      expect(result.isError, String(limit)).toBe(true)
      expect(textOf(result), String(limit)).toContain('limit')
    }

    // Absent, it means the maximum: the agent does not have to know about it.
    expect((await call(searchTaskTool, { query: 'token' })).isError).toBeFalsy()
    expect((await call(searchTaskTool, { query: 'token', limit: 1 })).isError).toBeFalsy()
  })

  it('refuses a query that is not text', async () => {
    const result = await call(searchTaskTool, { query: 42 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('query')
  })

  it('refuses an endless query', async () => {
    const result = await call(searchTaskTool, { query: 'x'.repeat(201) })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('200')
  })

  it('gives up when the call is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await call(searchTaskTool, { query: 'token' }, controller.signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/cancel/i)
  })
})

describe('putting a search into words', () => {
  it('names the section to continue in, so the agent knows what to read next', () => {
    const rendered = renderSearch(buildDemoTask(), 'token', 10)
    expect(rendered).toContain('read_task_detail')
  })
})
