import { text, type ModelContextTool } from './adapter'

/**
 * L'outil unique du J1.
 *
 * Il ne lit aucun état : il rend une chaîne fixe. C'est délibéré. La seule
 * question de cette journée est de savoir si un agent, dans une conversation
 * neuve et sans historique, découvre cet outil et l'appelle de lui-même. Tant
 * que la réponse n'est pas oui, construire un magasin, une interface ou six
 * outils ne prouve rien.
 */

/**
 * La description est le seul texte qui décide si l'agent appelle l'outil ou
 * non. Elle dit QUAND appeler avant de dire ce que l'outil fait : un agent
 * n'appelle pas un outil parce qu'il comprend sa fonction, mais parce qu'il
 * comprend qu'il en a besoin maintenant.
 *
 * Toute reformulation doit être rejouée contre un agent réel. C'est ici que se
 * gagne ou se perd la reprise après perte de contexte.
 */
export const RESUME_TASK_DESCRIPTION = `Persistent, human-supervised checkpoint for the current task.
This page holds the canonical task state: active constraints,
completed work with evidence, rejected approaches, and the next
action.

Call this tool BEFORE doing any work if you do not already know
the current task state — including at the start of a new
conversation, after any context loss or summarization, and
whenever a write is refused as stale.`

/**
 * État de démonstration, figé.
 *
 * Il porte volontairement deux contraintes et deux approches rejetées : le test
 * du J1 ne se contente pas de vérifier que l'outil est appelé, il vérifie que
 * ce qu'il rend est *lu*. Un agent qui reprend correctement citera l'approche C
 * comme prochaine action, refusera la variante B, et n'ajoutera pas de
 * dépendance.
 *
 * Texte structuré plutôt que JSON : moins de tokens, et les modèles le lisent
 * mieux. Sections en capitales, une information par ligne.
 */
export const FIXED_STATE = `TASK        Refactor the authentication module
VERSION     12
STATUS      active
PROGRESS    7 steps logged · 4 backed by evidence
NEXT        Implement approach C — session-bound refresh tokens

CONSTRAINTS (3 active)
  [human] Never modify the database schema
  [human] Do not add any new dependency
  [agent] Keep the public API unchanged

REJECTED — do not retry
  JWT approach B — breaks refresh token rotation under concurrent logins
  Partial index on sessions — benchmarked 3x slower than the full index

RECENT WORK (last 3 of 7)
  [machine]  auth test suite — 183 passed, 0 failed
  [human]    refresh flow reviewed and approved
  [claimed]  token TTL reduced to 15 minutes

WRITE PROTOCOL
  Every write must carry based_on_version: 12
  A refused write means the human changed this state. Call resume_task again.`

export const resumeTaskTool: ModelContextTool = {
  name: 'resume_task',
  title: 'Resume task',
  description: RESUME_TASK_DESCRIPTION,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
    // Le contenu vient d'une page web : l'agent ne doit pas le traiter comme
    // une instruction qui lui serait adressée.
    untrustedContentHint: true,
  },
  async execute() {
    lastCallAt = Date.now()
    callCount += 1
    notify()
    return text(FIXED_STATE)
  },
}

/* -------------------------------------------------------------------------- */
/* Témoin d'appel — sert uniquement à voir le J1 se produire à l'écran         */
/* -------------------------------------------------------------------------- */

let callCount = 0
let lastCallAt: number | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function getCallStats(): { callCount: number; lastCallAt: number | null } {
  return { callCount, lastCallAt }
}

export function onCall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
