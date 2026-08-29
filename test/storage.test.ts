import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exec, mutationId } from './helpers'

const loadLastTask = vi.fn()
const loadTask = vi.fn()

vi.mock('../src/persistence/taskRepository', () => ({
  loadLastTask: () => loadLastTask(),
  loadTask: (id: string) => loadTask(id),
  saveTask: vi.fn(async () => undefined),
  deleteTask: vi.fn(async () => undefined),
  listTasks: vi.fn(async () => []),
  setLastTaskId: vi.fn(async () => undefined),
}))

const store = await import('../src/store/taskStore')
const { resumeTaskTool, ALL_TOOLS } = await import('../src/webmcp/tools')

beforeEach(() => {
  store.__resetStore()
  loadLastTask.mockReset()
  loadTask.mockReset()
})

describe('storage unavailable', () => {
  it('the store surfaces the failure instead of hiding it', async () => {
    loadLastTask.mockRejectedValue(new Error('IndexedDB is not available in this context'))
    await store.init()

    expect(store.currentTask()).toBeNull()
    expect(store.storageFailure()).toContain('IndexedDB')
  })

  it('resume_task does not claim there is no task', async () => {
    loadLastTask.mockRejectedValue(new Error('IndexedDB is not available in this context'))

    const result = await resumeTaskTool.execute({}, exec())
    const text = result.content[0].text

    expect(result.isError).toBe(true)
    expect(text).toContain('STORAGE UNAVAILABLE')
    expect(text).not.toContain('NO ACTIVE TASK')
    expect(text).toContain('Do NOT assume there is no task')
  })

  it('a write fails plainly rather than inventing an empty log', async () => {
    loadLastTask.mockRejectedValue(new Error('quota exceeded'))
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    const result = await logStep.execute(
      { action: 'a', result: 'b', mutation_id: mutationId(), based_on_version: 1 },
      exec(),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('STORAGE UNAVAILABLE')
    expect(result.content[0].text).toContain('quota exceeded')
  })

  it('still tells apart a log that is genuinely absent', async () => {
    loadLastTask.mockResolvedValue(undefined)

    const result = await resumeTaskTool.execute({}, exec())
    expect(result.content[0].text).toContain('NO ACTIVE TASK')
    expect(result.content[0].text).not.toContain('STORAGE UNAVAILABLE')
  })
})
