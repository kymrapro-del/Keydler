export type Call = { tool: string; at: number; refused: boolean }

const MAX_RETENUS = 20

/**
 * Les lectures sont nommées ici plutôt qu'importées de `tools.ts` : le témoin
 * est appelé DEPUIS `tools.ts`, et l'importer en retour ferait un cycle. Un
 * test parcourt READ_TOOLS et vérifie que cette liste ne dérive pas.
 */
const READS = new Set(['resume_task', 'what_changed', 'read_task_detail', 'search_task'])

let total = 0
let refusés = 0
let recents: Call[] = []
let sawRead = false
let blindWrites = 0
const listeners = new Set<() => void>()

export function recordCall(tool: string, refused: boolean): void {
  total += 1
  if (refused) refusés += 1

  if (READS.has(tool)) {
    if (!refused) sawRead = true
  } else if (!sawRead && !refused) {
    blindWrites += 1
  }

  recents.push({ tool, at: Date.now(), refused })
  if (recents.length > MAX_RETENUS) recents = recents.slice(-MAX_RETENUS)

  for (const listener of listeners) listener()
}

export type WitnessState = {
  total: number
  refused: number
  sawRead: boolean
  blindWrites: number
  recents: readonly Call[]
}

export function getWitness(): WitnessState {
  return { total, refused: refusés, sawRead, blindWrites, recents: [...recents] }
}

export function onCall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCalls(): void {
  total = 0
  refusés = 0
  sawRead = false
  blindWrites = 0
  recents = []
  for (const listener of listeners) listener()
}
