import { beforeEach, describe, expect, it } from 'vitest'
import * as store from '../src/store/taskStore'
import { setNext } from '../src/domain/task'
import { resumeTaskTool } from '../src/webmcp/tools'
import { call, clearDatabase, currentTask, settle } from './helpers'

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('chargement initial concurrent à une écriture', () => {
  it('ne remplace pas l’état appliqué par une lecture du disque plus ancienne', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')

    const premier = store.mutate((s) => setNext(s, { next: 'première', basedOnVersion: null }))
    const agent = call(resumeTaskTool)
    const second = store.mutate((s) =>
      setNext(s, { next: 'nouvelle prochaine action', basedOnVersion: null }),
    )

    await Promise.all([premier, agent, second])
    await settle(4)

    const final = currentTask()
    expect(final.version).toBe(task.version + 2)
    expect(final.next).toBe('nouvelle prochaine action')
  })

  it('ne fait jamais reculer la version, même sur plusieurs écritures en vol', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const versions: number[] = []
    store.subscribe(() => {
      const v = store.currentTask()?.version
      if (v !== undefined) versions.push(v)
    })

    const écritures = [
      store.mutate((s) => setNext(s, { next: 'une', basedOnVersion: null })),
      call(resumeTaskTool),
      store.mutate((s) => setNext(s, { next: 'deux', basedOnVersion: null })),
    ]
    await Promise.all(écritures)
    await settle(4)

    const reculs = versions.filter((v, i) => i > 0 && v < versions[i - 1])
    expect(reculs).toEqual([])
    expect(currentTask().version).toBe(task.version + 2)
  })
})
