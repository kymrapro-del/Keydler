import { beforeEach, describe, expect, it } from 'vitest'
import { ConcurrentWriteError } from '../src/domain/errors'
import { addConstraint, logStep } from '../src/domain/task'
import { getDb } from '../src/persistence/db'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { ALL_TOOLS } from '../src/webmcp/tools'
import { exec, mutationId, storeWrite } from './helpers'

async function clearDatabase() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

async function autreOnglet(id: string, muter: (s: Parameters<typeof logStep>[0]) => typeof s) {
  const disque = await loadTask(id)
  if (!disque) throw new Error('cahier introuvable')
  await saveTask(muter(disque))
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('conflit entre pages', () => {
  it('refuse d’écraser une version écrite par une autre page', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')

    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    await expect(
      store.mutate((s) => addConstraint(s, { rule: 'posée ici', basedOnVersion: null }, 'human')),
    ).rejects.toBeInstanceOf(ConcurrentWriteError)

    const disque = await loadTask(task.id)
    expect(disque?.constraints.map((c) => c.rule)).toEqual(['posée ailleurs'])
  })

  it('se resynchronise pour que l’écran cesse de mentir', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    expect(store.currentTask()?.version).toBe(1)

    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    await expect(
      store.mutate((s) => addConstraint(s, { rule: 'posée ici', basedOnVersion: null }, 'human')),
    ).rejects.toBeInstanceOf(ConcurrentWriteError)

    expect(store.currentTask()?.version).toBe(2)
    expect(store.currentTask()?.constraints.map((c) => c.rule)).toEqual(['posée ailleurs'])
  })

  it('dit à l’agent de rappeler resume_task', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    const logStepTool = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const result = await logStepTool.execute(
      { action: 'a', result: 'b', mutation_id: mutationId(), based_on_version: 1 },
      exec(),
    )

    expect(result.isError).toBe(true)
    const text = result.content[0].text
    expect(text).toContain('STALE STATE')
    expect(text).toContain('what_changed')
    expect(text).toContain('resume_task')
    expect(text.startsWith('STALE STATE')).toBe(true)
  })

  it('réussit une fois la version rafraîchie', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    await store.mutate((s) => s).catch(() => undefined)
    const v = store.currentTask()!.version

    const after = await store.mutateAsAgent(
      storeWrite('log_step', v, { n: v }, (s) =>
        logStep(s, { action: 'a', result: 'b', basedOnVersion: v }, 'agent'),
      ),
    )
    expect(after.version).toBe(v + 1)
    expect(after.replayed).toBe(false)
    expect(store.currentTask()!.steps).toHaveLength(1)
  })
})
