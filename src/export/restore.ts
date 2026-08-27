import { normalizeTask } from '../persistence/normalize'
import type { TaskState } from '../domain/types'

export class NothingToImportError extends Error {
  constructor() {
    super(
      'No watch log found in that file. Use a file produced by “Export this task” ' +
        'or “Export all tasks”.',
    )
    this.name = 'NothingToImportError'
  }
}

const FENCE = /^(`{3,})json\s*$/

export function parseExport(markdown: string): TaskState[] {
  const lines = markdown.split(/\r?\n/)
  const found: TaskState[] = []

  let fence: string | null = null
  let buffer: string[] = []

  for (const line of lines) {
    if (fence === null) {
      const opening = FENCE.exec(line.trim())
      if (opening) {
        fence = opening[1]
        buffer = []
      }
      continue
    }

    if (line.trim() === fence) {
      fence = null
      const task = readTask(buffer.join('\n'))
      if (task) found.push(task)
      continue
    }

    buffer.push(line)
  }

  if (found.length === 0) throw new NothingToImportError()
  return found
}

function readTask(raw: string): TaskState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const candidate = parsed as { id?: unknown; title?: unknown; version?: unknown }
  if (typeof candidate.id !== 'string' || candidate.id === '') return null
  if (typeof candidate.title !== 'string') return null
  if (typeof candidate.version !== 'number') return null

  try {
    return normalizeTask(parsed as never) ?? null
  } catch {
    return null
  }
}
