import { vi } from 'vitest'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import type { ModelContextTool, RegisteredTool, ToolResult } from '../src/webmcp/adapter'
import type { TaskState } from '../src/domain/types'
import { fingerprintIntent } from '../src/domain/intent'

export async function clearDatabase(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta', 'secrets'], 'readwrite')
  await Promise.all([
    tx.objectStore('tasks').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('secrets').clear(),
    tx.done,
  ])
}

export async function waitUntil(
  predicate: () => boolean,
  what = 'la condition attendue',
  tours = 300,
): Promise<void> {
  for (let i = 0; i < tours; i++) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error(`délai dépassé en attendant : ${what}`)
}

export function call(
  tool: ModelContextTool,
  input: Record<string, unknown> = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<ToolResult> {
  return tool.execute(input, { signal })
}

export function exec(signal?: AbortSignal): { signal: AbortSignal } {
  return { signal: signal ?? new AbortController().signal }
}

export function textOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n')
}

let compteur = 0

export function mutationId(prefix = 'm'): string {
  compteur += 1
  return `${prefix}-test-${compteur.toString().padStart(6, '0')}`
}

export function storeWrite(
  operation: string,
  basedOnVersion: number,
  intent: Record<string, unknown>,
  mutate: (state: TaskState) => TaskState,
  id = mutationId(),
) {
  return {
    operation,
    basedOnVersion,
    mutationId: id,
    fingerprint: fingerprintIntent(operation, intent),
    mutate,
    render: (next: TaskState) => `v${next.version}`,
  }
}

export function writeArgs(
  task: TaskState,
  extra: Record<string, unknown> = {},
  id = mutationId(),
): Record<string, unknown> {
  return { based_on_version: task.version, mutation_id: id, ...extra }
}

export function currentTask(): TaskState {
  const task = store.currentTask()
  if (!task) throw new Error('aucun cahier ouvert')
  return task
}

export class FakeModelContext extends EventTarget {
  readonly tools = new Map<string, ModelContextTool>()
  readonly attempts: string[] = []
  failOn = new Set<string>()

  private enAttente: (() => void)[] = []
  lent = false

  reprendre(): void {
    const attendus = this.enAttente
    this.enAttente = []
    for (const release of attendus) release()
  }

  registerTool = vi.fn(
    async (tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> => {
      this.attempts.push(tool.name)

      if (this.lent) {
        await new Promise<void>((resolve) => this.enAttente.push(resolve))
      }

      if (options?.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('aborted', 'AbortError')
      }
      if (this.tools.has(tool.name)) {
        throw new DOMException(`tool "${tool.name}" is already registered`, 'InvalidStateError')
      }
      if (this.failOn.has(tool.name)) {
        throw new DOMException(`refused: ${tool.name}`, 'NotAllowedError')
      }

      this.tools.set(tool.name, tool)
      options?.signal?.addEventListener('abort', () => {
        this.tools.delete(tool.name)
        this.dispatchEvent(new Event('toolchange'))
      })
      this.dispatchEvent(new Event('toolchange'))
    },
  )

  getTools = vi.fn(async (): Promise<RegisteredTool[]> =>
    [...this.tools.values()]
      .map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  )

  names(): string[] {
    return [...this.tools.keys()].sort()
  }
}

export function installModelContext(): FakeModelContext {
  const fake = new FakeModelContext()
  Object.defineProperty(document, 'modelContext', { configurable: true, value: fake })
  return fake
}

export function removeModelContext(): void {
  Reflect.deleteProperty(document, 'modelContext')
}

export async function settle(tours = 4): Promise<void> {
  for (let i = 0; i < tours; i++) await new Promise((r) => setTimeout(r, 0))
}

export function pretendChromium(major: number | null, brand = 'Chromium'): void {
  if (major === null) {
    Reflect.deleteProperty(navigator, 'userAgentData')
    return
  }
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: {
      brands: [
        { brand: 'Not(A:Brand', version: '8' },
        { brand: brand, version: String(major) },
      ],
    },
  })
}

export function resetUserAgentData(): void {
  Reflect.deleteProperty(navigator, 'userAgentData')
}
