import { beforeEach, describe, expect, it } from 'vitest'
import { createTask } from '../src/domain/task'
import { MAX_MUTATION_RECORDS, SCHEMA_VERSION } from '../src/domain/types'
import { getDb } from '../src/persistence/db'
import { FutureSchemaError, normalizeTask } from '../src/persistence/normalize'
import { escapeHtml } from '../src/ui/escape'
import { listTasks, loadTask, saveTask } from '../src/persistence/taskRepository'

async function clear() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

async function writeRaw(record: unknown) {
  const db = await getDb()
  await db.put('tasks', record as never)
}

beforeEach(clear)

describe('normalizing on read', () => {
  it('survives a record with no audit log and no arrays', async () => {
    await writeRaw({ id: 'old', title: "Yesterday's task", version: 7, updatedAt: 1 })

    const task = await loadTask('old')
    expect(task).toBeDefined()
    expect(task!.version).toBe(7)
    expect(task!.audit).toEqual([])
    expect(task!.steps).toEqual([])
    expect(task!.constraints).toEqual([])
    expect(task!.rejected).toEqual([])
    expect(task!.decisions).toEqual([])
  })

  it('takes a constraint with an unreadable state to be ACTIVE', () => {
    const task = normalizeTask({
      id: 'x',
      version: 1,
      constraints: [{ id: 'c1', rule: 'Do not touch the schema' }],
    } as never)

    expect(task!.constraints[0].active).toBe(true)
  })

  it('brings an unknown confidence level back to "claimed"', () => {
    const task = normalizeTask({
      id: 'x',
      version: 1,
      steps: [{ id: 's1', action: 'a', result: 'b', confidence: 'fully_proven' }],
    } as never)

    expect(task!.steps[0].confidence).toBe('claimed')
  })

  it('drops evidence whose kind is unknown', () => {
    const task = normalizeTask({
      id: 'x',
      version: 1,
      steps: [
        { id: 's1', action: 'a', result: 'b', evidence: { kind: 'telepathy', content: 'x' } },
      ],
    } as never)

    expect(task!.steps[0].evidence).toBeNull()
  })

  it('keeps an id exactly as given: it is the primary key', async () => {
    const bizarre = 'x" onload="alert(1)'
    await writeRaw({ id: bizarre, title: 'Task', version: 3, updatedAt: 1 })

    const reread = await loadTask(bizarre)
    expect(reread?.id).toBe(bizarre)
    expect(reread?.version).toBe(3)
  })

  it('defuses a hostile id at render, not at storage', () => {
    const task = normalizeTask({
      id: 'x" onload="alert(1)',
      version: 1,
      steps: [{ id: 's1"><script>', action: 'a', result: 'b' }],
    } as never)

    expect(task!.steps[0].id).toBe('s1"><script>')
    expect(escapeHtml(task!.steps[0].id)).not.toContain('"')
    expect(escapeHtml(task!.steps[0].id)).not.toContain('<')
  })

  it('refuses a record written by a newer version', async () => {
    await writeRaw({ id: 'future', title: 'X', version: 1, schemaVersion: SCHEMA_VERSION + 1 })

    await expect(loadTask('future')).rejects.toBeInstanceOf(FutureSchemaError)
  })

  it('does not take the whole list down for one unreadable record', async () => {
    const sain = createTask({ title: 'Sain', next: 'Continue' })
    await saveTask(sain)
    await writeRaw({ id: 'future', title: 'X', version: 1, schemaVersion: SCHEMA_VERSION + 1 })

    const tasks = await listTasks()
    expect(tasks.map((t) => t.title)).toEqual(['Sain'])
  })

  it('repairs decisions, rejections and audit log of a mangled record', () => {
    const task = normalizeTask({
      id: 'x',
      version: 2,
      decisions: [{ id: 'd1', choice: 'Approach C' }, null],
      rejected: [{ id: 'r1', approach: 'JWT B', source: 'human' }, null],
      audit: [{ id: 'a1', operation: 'log_step', outcome: 'refused', repeated: 3 }, { id: 'a2' }],
    } as never)

    expect(task!.decisions).toHaveLength(1)
    expect(task!.decisions[0]).toMatchObject({
      choice: 'Approach C',
      rationale: '',
      source: 'agent',
    })
    expect(task!.rejected).toHaveLength(1)
    expect(task!.rejected[0]).toMatchObject({ approach: 'JWT B', reason: '', source: 'human' })
    expect(task!.audit[0]).toMatchObject({ outcome: 'refused', repeated: 3 })
    expect(task!.audit[1].outcome).toBe('applied')
    expect(task!.audit[1].actor).toBe('agent')
    expect(task!.audit[1].repeated).toBeUndefined()
  })

  it('leaves an ordinary task intact', async () => {
    const original = createTask({ title: 'Normal', next: 'Suite' })
    await saveTask(original)

    const reread = await loadTask(original.id)
    expect(reread).toMatchObject({
      id: original.id,
      title: 'Normal',
      version: original.version,
      next: 'Suite',
      status: 'active',
    })
    expect(reread!.audit).toHaveLength(original.audit.length)
  })
})

describe('schema v1 migration', () => {
  function v1(): Record<string, unknown> {
    return {
      id: 'old-1',
      title: 'Task from before',
      version: 4,
      status: 'active',
      schemaVersion: 1,
      constraints: [
        { id: 'c1', rule: 'Human rule', source: 'human', addedAtVersion: 2, active: true },
        { id: 'c2', rule: 'Agent rule', source: 'agent', addedAtVersion: 3, active: true },
      ],
      rejected: [
        { id: 'r1', approach: 'A', reason: 'r', source: 'human', addedAtVersion: 2 },
        { id: 'r2', approach: 'B', reason: 'r', source: 'agent', addedAtVersion: 3 },
      ],
      steps: [
        {
          id: 's1',
          action: 'Ran the tests',
          result: 'ok',
          confidence: 'machine_verified',
          evidence: { kind: 'test_report', content: '183 passed', verifiedAt: null },
        },
      ],
      decisions: [],
      audit: [],
    }
  }

  it('gives the human back an authority that had been taken', () => {
    const task = normalizeTask(v1() as never)!

    expect(task.constraints[0].standing).toBe('accepted')
    expect(task.constraints[1].standing).toBe('proposed')
    expect(task.rejected[0].standing).toBe('accepted')
    expect(task.rejected[1].standing).toBe('proposed')
  })

  it('renames "machine_verified" without inventing a human click', () => {
    const task = normalizeTask(v1() as never)!

    expect(task.steps[0].confidence).toBe('evidence')
    expect(task.steps[0].evidence?.content).toBe('183 passed')
    expect(task.steps[0].evidence?.verifiedAt).toBeNull()
  })

  it('gives an empty mutation memory rather than crashing on it', () => {
    const task = normalizeTask(v1() as never)!
    expect(task.mutations).toEqual([])
  })

  it('bounds and cleans a doubtful mutation memory', () => {
    const stored = {
      ...v1(),
      schemaVersion: 3,
      mutations: [
        { id: '', operation: 'log_step', version: 2, fingerprint: 'f', result: 'x', at: 1 },
        ...Array.from({ length: MAX_MUTATION_RECORDS + 20 }, (_, i) => ({
          id: `m${i}`,
          operation: 'log_step',
          version: i,
          fingerprint: `f${i}`,
          result: 'ok',
          at: i,
        })),
      ],
    }
    const task = normalizeTask(stored as never)!
    expect(task.mutations.length).toBe(MAX_MUTATION_RECORDS)
    expect(task.mutations.every((m) => m.id !== '')).toBe(true)
  })

  it('drops a v2 mutation, whose intent cannot be verified', () => {
    const stored = {
      ...v1(),
      schemaVersion: 2,
      mutations: [
        {
          id: 'm-with-fingerprint',
          operation: 'log_step',
          version: 2,
          fingerprint: 'f',
          result: 'ok',
          at: 1,
        },
        { id: 'm-without-fingerprint', operation: 'log_step', version: 3, result: 'ok', at: 2 },
      ],
    }
    const task = normalizeTask(stored as never)!

    expect(task.mutations.map((m) => m.id)).toEqual(['m-with-fingerprint'])
  })

  it('still refuses a record newer than the code reading it', () => {
    expect(() => normalizeTask({ ...v1(), schemaVersion: 99 } as never)).toThrow(FutureSchemaError)
  })
})
