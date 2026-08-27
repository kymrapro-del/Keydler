import {
  checkAvailability,
  getModelContext,
  type Availability,
  type ModelContextLike,
  type ModelContextTool,
} from './adapter'
import { READ_TOOLS, WRITE_TOOLS } from './tools'
import { detectLifecycle, type ToolLifecycle } from './lifecycle'

export { detectLifecycle, DYNAMIC_UNREGISTER_MIN_CHROMIUM } from './lifecycle'
export type { LifecycleMode, ToolLifecycle } from './lifecycle'
import * as store from '../store/taskStore'

export type RegistrationPhase = 'pending' | 'registered' | 'partial' | 'unsupported' | 'failed'

export type RegistrationState = {
  phase: RegistrationPhase
  availability: Availability
  toolNames: string[]
  failures: { name: string; reason: string }[]
  lifecycle: ToolLifecycle
  error: string | null
  observedTools: string[] | null
}

const GUARD = Symbol.for('cahier-de-quart.webmcp.registered')
type GuardedGlobal = typeof globalThis & { [GUARD]?: boolean }

let state: RegistrationState = {
  phase: 'pending',
  availability: { supported: false, reason: 'no-api' },
  toolNames: [],
  failures: [],
  lifecycle: { mode: 'static', chromiumMajor: null, reason: 'not detected yet' },
  error: null,
  observedTools: null,
}

const listeners = new Set<() => void>()

function setState(next: RegistrationState): void {
  state = next
  for (const listener of listeners) listener()
}

export function getRegistrationState(): RegistrationState {
  return state
}

export function onRegistrationChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function toolsForCurrentState(): ModelContextTool[] {
  const { status, task } = store.getSnapshot()
  const écrivable = status === 'ready' && task !== null && task.status === 'active'
  return écrivable ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS]
}

const registered = new Map<string, AbortController>()

function raison(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

async function sync(modelContext: ModelContextLike): Promise<void> {
  const voulus = toolsForCurrentState()
  const noms = new Set(voulus.map((t) => t.name))
  const lifecycle = getRegistrationState().lifecycle

  if (lifecycle.mode === 'dynamic') {
    for (const [nom, controller] of [...registered]) {
      if (noms.has(nom)) continue
      controller.abort()
      registered.delete(nom)
    }
  }

  const àPoser = voulus.filter((t) => !registered.has(t.name))

  const issues = await Promise.allSettled(
    àPoser.map(async (tool) => {
      const controller = new AbortController()
      try {
        await modelContext.registerTool(tool, { signal: controller.signal })
        return { tool, controller }
      } catch (error) {
        controller.abort()
        throw error
      }
    }),
  )

  const motifs = new Map<string, string>()
  issues.forEach((issue, i) => {
    if (issue.status === 'fulfilled') {
      registered.set(issue.value.tool.name, issue.value.controller)
    } else {
      motifs.set(àPoser[i].name, raison(issue.reason))
    }
  })

  const failures = voulus
    .filter((t) => !registered.has(t.name))
    .map((t) => ({ name: t.name, reason: motifs.get(t.name) ?? 'not registered' }))

  const posés = [...registered.keys()]
  const availability = checkAvailability()

  setState({
    phase: failures.length === 0 ? 'registered' : posés.length > 0 ? 'partial' : 'failed',
    availability,
    toolNames: posés,
    failures,
    lifecycle,
    error: failures.length > 0 ? failures.map((f) => `${f.name} — ${f.reason}`).join(' ; ') : null,
    observedTools: state.observedTools,
  })
}

let file: Promise<void> = Promise.resolve()

function syncQueued(modelContext: ModelContextLike): Promise<void> {
  file = file.then(
    () => sync(modelContext),
    () => sync(modelContext),
  )
  return file
}

async function observeRegisteredTools(modelContext: ModelContextLike): Promise<void> {
  if (typeof modelContext.getTools !== 'function') return
  try {
    const outils = await modelContext.getTools()
    setState({ ...state, observedTools: outils.map((t) => t.name) })
  } catch {}
}

function unregisterAll(): void {
  for (const controller of registered.values()) controller.abort()
  registered.clear()
}

let détacher: (() => void) | null = null

export async function registerTools(): Promise<RegistrationState> {
  const guarded = globalThis as GuardedGlobal
  if (guarded[GUARD]) return state
  guarded[GUARD] = true

  const availability = checkAvailability()
  const modelContext = availability.supported ? getModelContext() : null
  const lifecycle = detectLifecycle()

  if (!modelContext) {
    setState({
      phase: 'unsupported',
      availability,
      toolNames: [],
      failures: [],
      lifecycle,
      error: null,
      observedTools: null,
    })
    return state
  }

  const surToolChange = () => void observeRegisteredTools(modelContext)
  modelContext.addEventListener?.('toolchange', surToolChange)

  const désabonner = store.subscribe(() => void syncQueued(modelContext))

  détacher = () => {
    désabonner()
    modelContext.removeEventListener?.('toolchange', surToolChange)
    unregisterAll()
  }

  setState({ ...state, lifecycle })
  await syncQueued(modelContext)
  await observeRegisteredTools(modelContext)

  return state
}

export function __resetRegistration(): void {
  const guarded = globalThis as GuardedGlobal
  delete guarded[GUARD]
  détacher?.()
  détacher = null
  file = Promise.resolve()
  unregisterAll()
  listeners.clear()
  state = {
    phase: 'pending',
    availability: { supported: false, reason: 'no-api' },
    toolNames: [],
    failures: [],
    lifecycle: { mode: 'static', chromiumMajor: null, reason: 'not detected yet' },
    error: null,
    observedTools: null,
  }
}
