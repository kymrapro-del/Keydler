export type Call = { tool: string; at: number; refused: boolean }

const MAX_RETENUS = 20

let total = 0
let refusés = 0
let recents: Call[] = []
const listeners = new Set<() => void>()

export function recordCall(tool: string, refused: boolean): void {
  total += 1
  if (refused) refusés += 1

  recents.push({ tool, at: Date.now(), refused })
  if (recents.length > MAX_RETENUS) recents = recents.slice(-MAX_RETENUS)

  for (const listener of listeners) listener()
}

export type WitnessState = {
  total: number
  refused: number
  recents: readonly Call[]
}

export function getWitness(): WitnessState {
  return { total, refused: refusés, recents: [...recents] }
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
  recents = []
  for (const listener of listeners) listener()
}
