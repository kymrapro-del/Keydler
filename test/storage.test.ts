import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Panne de stockage.
 *
 * Le contrôle avant dépôt impose un essai en navigation privée, où IndexedDB
 * peut être restreint. Si la page confond « stockage cassé » et « aucun
 * cahier », un agent conclut qu'il n'y a rien à reprendre — et un juge conclut
 * que le produit ne fait rien.
 */

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

describe('stockage indisponible', () => {
  it('le magasin expose la panne au lieu de la taire', async () => {
    loadLastTask.mockRejectedValue(new Error('IndexedDB is not available in this context'))
    await store.init()

    expect(store.currentTask()).toBeNull()
    expect(store.storageFailure()).toContain('IndexedDB')
  })

  it('resume_task ne prétend pas qu’il n’y a pas de tâche', async () => {
    loadLastTask.mockRejectedValue(new Error('IndexedDB is not available in this context'))

    const result = await resumeTaskTool.execute({}, {})
    const texte = result.content[0].text

    expect(result.isError).toBe(true)
    expect(texte).toContain('STORAGE UNAVAILABLE')
    // La confusion à éviter à tout prix.
    expect(texte).not.toContain('NO ACTIVE TASK')
    expect(texte).toContain('Do NOT assume there is no task')
  })

  it('une écriture échoue clairement plutôt que d’inventer un cahier vide', async () => {
    loadLastTask.mockRejectedValue(new Error('quota exceeded'))
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    const result = await logStep.execute({ action: 'a', result: 'b', based_on_version: 1 }, {})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('STORAGE UNAVAILABLE')
    expect(result.content[0].text).toContain('quota exceeded')
  })

  it('distingue toujours un cahier réellement absent', async () => {
    loadLastTask.mockResolvedValue(undefined)

    const result = await resumeTaskTool.execute({}, {})
    expect(result.content[0].text).toContain('NO ACTIVE TASK')
    expect(result.content[0].text).not.toContain('STORAGE UNAVAILABLE')
  })
})
