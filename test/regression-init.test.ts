import { beforeEach, describe, expect, it } from 'vitest'
import * as store from '../src/store/taskStore'
import { setNext } from '../src/domain/task'
import { resumeTaskTool } from '../src/webmcp/tools'
import { call, clearDatabase, currentTask, settle } from './helpers'

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('initial load racing a write', () => {
  it('does not replace the applied state with an older read from disk', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')

    const first = store.mutate((s) => setNext(s, { next: 'first', basedOnVersion: null }))
    const agent = call(resumeTaskTool)
    const second = store.mutate((s) =>
      setNext(s, { next: 'new next action', basedOnVersion: null }),
    )

    await Promise.all([first, agent, second])
    await settle(4)

    const final = currentTask()
    expect(final.version).toBe(task.version + 2)
    expect(final.next).toBe('new next action')
  })

  it('never walks the version backwards, even with several writes in flight', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    const versions: number[] = []
    store.subscribe(() => {
      const v = store.currentTask()?.version
      if (v !== undefined) versions.push(v)
    })

    const writes = [
      store.mutate((s) => setNext(s, { next: 'one', basedOnVersion: null })),
      call(resumeTaskTool),
      store.mutate((s) => setNext(s, { next: 'two', basedOnVersion: null })),
    ]
    await Promise.all(writes)
    await settle(4)

    const reculs = versions.filter((v, i) => i > 0 && v < versions[i - 1])
    expect(reculs).toEqual([])
    expect(currentTask().version).toBe(task.version + 2)
  })
})
