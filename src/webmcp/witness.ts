export type Call = { tool: string; at: number; refused: boolean }

const MAX_RETENUS = 20

/**
 * The reads are named here rather than imported from `tools.ts`: the witness is
 * called from `tools.ts`, and importing it back would make a cycle. A test
 * walks READ_TOOLS and checks that this list does not drift.
 */
const READS = new Set(['resume_task', 'what_changed', 'read_task_detail', 'search_task'])

/**
 * A write, but never a blind one : it is what brings the task into existence,
 * so there was nothing to read before it. Counting it against the "read before
 * writing" figure would make the one number this page reports about agent
 * behaviour wrong in the only case where the agent had no choice.
 */
const CREATES = new Set(['create_task'])

let total = 0
let refusedCalls = 0
let recents: Call[] = []
let sawRead = false
let blindWrites = 0
const listeners = new Set<() => void>()

export function recordCall(tool: string, refused: boolean): void {
  total += 1
  if (refused) refusedCalls += 1

  if (READS.has(tool)) {
    if (!refused) sawRead = true
  } else if (!CREATES.has(tool) && !sawRead && !refused) {
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
  return { total, refused: refusedCalls, sawRead, blindWrites, recents: [...recents] }
}

export const RECENT_WINDOW = 10 * 60_000

/**
 * An observed call, not a presence: nothing in WebMCP says an agent is
 * "connected", and the screen must not suggest it.
 */
export function recentlyActive(now: number = Date.now()): Call | null {
  const last = recents[recents.length - 1]
  if (!last) return null
  return now - last.at <= RECENT_WINDOW ? last : null
}

export function onCall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCalls(): void {
  total = 0
  refusedCalls = 0
  sawRead = false
  blindWrites = 0
  recents = []
  for (const listener of listeners) listener()
}
