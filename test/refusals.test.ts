import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { ALL_TOOLS } from '../src/webmcp/tools'
import { exec, mutationId, storeWrite } from './helpers'

async function clear() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

const logStep = () => ALL_TOOLS.find((t) => t.name === 'log_step')!
const rejectApproach = () => ALL_TOOLS.find((t) => t.name === 'reject_approach')!

beforeEach(async () => {
  store.__resetStore()
  await clear()
})

describe('refusals on the record', () => {
  it('records a missing version, which never reaches the mutation', async () => {
    await store.createAndOpenTask('Task', 'Continue')
    const before = store.currentTask()!.audit.length

    const result = await logStep().execute({ action: 'a', result: 'b' }, exec())

    expect(result.isError).toBe(true)
    const after = store.currentTask()!
    expect(after.audit.length).toBe(before + 1)
    expect(after.audit.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
    expect(after.version).toBe(1)
  })

  it('records an unreadable version', async () => {
    await store.createAndOpenTask('Task', undefined)

    const result = await logStep().execute(
      { action: 'a', result: 'b', mutation_id: mutationId(), based_on_version: 'pread tard' },
      exec(),
    )

    expect(result.isError).toBe(true)
    expect(store.currentTask()!.audit.at(-1)).toMatchObject({ outcome: 'refused' })
  })

  it('does not record twice a refusal the store already logged', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
    const before = store.currentTask()!.audit.length

    const result = await rejectApproach().execute(
      {
        approach: 'JWT B',
        reason: '   ',
        mutation_id: mutationId(),
        based_on_version: task.version,
      },
      exec(),
    )

    expect(result.isError).toBe(true)
    expect(store.currentTask()!.audit.length).toBe(before + 1)
  })

  it('says nothing was written and gives the version to retry with', async () => {
    const task = await store.createAndOpenTask('Task', undefined)

    const result = await rejectApproach().execute(
      { approach: 'JWT B', reason: '', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    const text = result.content[0].text
    expect(text).toContain('INVALID INPUT')
    expect(text).toContain('Nothing was written.')
    expect(text).toContain(`based_on_version: ${task.version}`)
  })

  it('leaves that reminder off a stale state refusal', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
    await store.mutateAsAgent(
      storeWrite('add_constraint', task.version, { rule: 'x' }, (s) => ({
        ...s,
        version: s.version + 1,
      })),
    )
    const result = await logStep().execute(
      { action: 'a', result: 'b', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    const text = result.content[0].text
    expect(text).toContain('STALE STATE')
    // The "retry with based_on_version" reminder makes no sense here: the
    // version the agent held is precisely the one that was refused.
    expect(text).not.toMatch(/Retry with based_on_version/i)
    // The refusal must name the tool made for this exact case, not only the
    // full re-read: it is an agent's most frequent path.
    expect(text).toContain('what_changed')
    expect(text).toContain(`since_version: ${task.version}`)
    expect(text).toContain('resume_task')
  })
})

describe('retry advice', () => {
  it('does not suggest retrying on a closed task', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
    const complete = ALL_TOOLS.find((t) => t.name === 'complete_task')!
    await complete.execute(
      { summary: 'Done.', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    const result = await logStep().execute(
      {
        action: 'a',
        result: 'b',
        mutation_id: mutationId(),
        based_on_version: store.currentTask()!.version,
      },
      exec(),
    )

    const text = result.content[0].text
    expect(result.isError).toBe(true)
    expect(text).not.toContain('Retry with based_on_version')
    expect(text).toContain('Retrying will not help')
    expect(text).toContain('ask the human to reopen')
  })

  it('still suggests the retry when the input simply needs fixing', async () => {
    const task = await store.createAndOpenTask('Task', undefined)

    const result = await rejectApproach().execute(
      { approach: 'JWT B', reason: '', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    expect(result.content[0].text).toContain(`Retry with based_on_version: ${task.version}`)
  })
})
