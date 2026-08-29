import { normalizeTask } from '../persistence/normalize'
import type { TaskState } from '../domain/types'

export class NothingToImportError extends Error {
  constructor() {
    super(
      'No nightorder found in that file. Use a file produced by “Export this task” ' +
        'or “Export all tasks”.',
    )
    this.name = 'NothingToImportError'
  }
}

/**
 * A markdown export is read fully in memory before its fenced JSON records can
 * be inspected. Keep that allocation bounded at both the UI and parser
 * boundaries; two megabytes is already far beyond a normal local nightorder.
 */
export const MAX_IMPORT_BYTES = 2_000_000

export class ImportTooLargeError extends Error {
  constructor(size: number) {
    super(
      `That file is ${size.toLocaleString('en-US')} bytes. Imports are limited to ` +
        `${MAX_IMPORT_BYTES.toLocaleString('en-US')} bytes. Export or import smaller task files instead.`,
    )
    this.name = 'ImportTooLargeError'
  }
}

const FENCE = /^(`{3,})json\s*$/

export function parseExport(markdown: string): TaskState[] {
  const bytes = new TextEncoder().encode(markdown).byteLength
  if (bytes > MAX_IMPORT_BYTES) throw new ImportTooLargeError(bytes)

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
