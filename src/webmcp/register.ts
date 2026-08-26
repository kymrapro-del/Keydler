import { checkAvailability, getModelContext, type Availability } from './adapter'
import { ALL_TOOLS } from './tools'

/**
 * Enregistrement des outils.
 *
 * Ce module s'exécute UNE FOIS, à l'import, hors de tout cycle de rendu.
 *
 * La règle vaudra encore quand React arrivera au J4 : son mode strict monte les
 * composants deux fois en développement, et un `registerTool` appelé depuis un
 * `useEffect` produirait des outils dédoublés puis détruits — une journée de
 * débogage inexplicable. L'enregistrement vit ici, l'interface se contentera de
 * s'abonner à l'état exposé plus bas.
 *
 * Le garde-fou est posé sur `globalThis` et non sur une variable de module : le
 * remplacement de module à chaud réévalue le module, pas le contexte global.
 */

export type RegistrationState = {
  phase: 'pending' | 'registered' | 'unsupported' | 'failed'
  availability: Availability
  toolNames: string[]
  error: string | null
}

const GUARD = Symbol.for('cahier-de-quart.webmcp.registered')
type GuardedGlobal = typeof globalThis & { [GUARD]?: boolean }

let state: RegistrationState = {
  phase: 'pending',
  availability: { supported: false, reason: 'no-api' },
  toolNames: [],
  error: null,
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

/** Idempotent : les appels suivants ne font rien. */
export async function registerTools(): Promise<RegistrationState> {
  const guarded = globalThis as GuardedGlobal
  if (guarded[GUARD]) return state
  guarded[GUARD] = true

  const availability = checkAvailability()
  const modelContext = availability.supported ? getModelContext() : null

  if (!modelContext) {
    // Pas une panne : l'immense majorité des navigateurs sont dans ce cas.
    // La page doit rester lisible et dire quoi activer.
    setState({ phase: 'unsupported', availability, toolNames: [], error: null })
    return state
  }

  try {
    for (const tool of ALL_TOOLS) {
      await modelContext.registerTool(tool)
    }
    setState({
      phase: 'registered',
      availability,
      toolNames: ALL_TOOLS.map((t) => t.name),
      error: null,
    })
  } catch (error) {
    guarded[GUARD] = false
    setState({
      phase: 'failed',
      availability,
      toolNames: [],
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return state
}

/** Réinitialise le garde-fou. Réservé aux tests. */
export function __resetRegistration(): void {
  const guarded = globalThis as GuardedGlobal
  delete guarded[GUARD]
  listeners.clear()
  state = {
    phase: 'pending',
    availability: { supported: false, reason: 'no-api' },
    toolNames: [],
    error: null,
  }
}
