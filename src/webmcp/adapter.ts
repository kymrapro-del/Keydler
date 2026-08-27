export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export type ToolAnnotations = {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

export type ModelContextTool = {
  name: string
  title?: string
  description: string
  inputSchema?: object
  annotations?: ToolAnnotations
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<ToolResult>
}

export type RegisteredTool = {
  name: string
  title?: string
  description: string
  inputSchema?: object
  annotations?: ToolAnnotations
}

type ModelContextLike = {
  registerTool: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => Promise<void>
  getTools?: () => Promise<RegisteredTool[]>
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

declare global {
  interface Document {
    modelContext?: ModelContextLike
  }
  interface Navigator {
    modelContext?: ModelContextLike
  }
}

export function getModelContext(): ModelContextLike | null {
  if (typeof document === 'undefined') return null
  const candidate = document.modelContext ?? globalThis.navigator?.modelContext
  return candidate && typeof candidate.registerTool === 'function' ? candidate : null
}

export type Availability =
  | { supported: true; surface: 'document' | 'navigator' }
  | { supported: false; reason: 'no-api' | 'insecure-context' }

export function checkAvailability(): Availability {
  if (typeof document === 'undefined') return { supported: false, reason: 'no-api' }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { supported: false, reason: 'insecure-context' }
  }
  if (document.modelContext?.registerTool) return { supported: true, surface: 'document' }
  if (globalThis.navigator?.modelContext?.registerTool) {
    return { supported: true, surface: 'navigator' }
  }
  return { supported: false, reason: 'no-api' }
}

export function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] }
}

export function failure(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }], isError: true }
}

export type { ModelContextLike }
