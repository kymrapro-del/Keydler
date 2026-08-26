/**
 * Descriptions des outils.
 *
 * C'est le seul texte du projet qui mérite une demi-journée à lui seul. Un
 * agent n'appelle pas un outil parce qu'il comprend ce qu'il fait, mais parce
 * qu'il comprend qu'il en a besoin maintenant. Chaque description dit donc
 * QUAND appeler avant de dire ce que l'outil fait.
 *
 * Toute reformulation doit être rejouée contre un agent réel : c'est ici que
 * se gagne ou se perd la reprise après perte de contexte.
 */

export const RESUME_TASK_DESCRIPTION = `Persistent, human-supervised checkpoint for the current task.
This page holds the canonical task state: active constraints,
completed work with evidence, rejected approaches, and the next
action.

Call this tool BEFORE doing any work if you do not already know
the current task state — including at the start of a new
conversation, after any context loss or summarization, and
whenever a write is refused as stale.`

export const LOG_STEP_DESCRIPTION = `Record one completed step in the task's watch log, with its evidence.

Call this immediately AFTER finishing a unit of work — a file
changed, a command run, a test suite executed. Do not batch several
steps into one call, and do not call it for work you only intend to
do. Attach evidence whenever you have any: a step without evidence
is recorded as merely claimed, and a human will have to re-check it.

Requires based_on_version from the most recent resume_task.`

export const ADD_DECISION_DESCRIPTION = `Record a choice and the reasoning behind it.

Call this whenever you pick one option over another for a reason
that would not be obvious from the code alone — a trade-off, a
constraint you worked around, an assumption you made. This is the
"why", which every summary loses first.

Requires based_on_version from the most recent resume_task.`

export const REJECT_APPROACH_DESCRIPTION = `Record an approach that was tried and must not be retried, with the
reason it failed.

Call this the moment an approach is ruled out — it failed, it broke
something, it was benchmarked and rejected, or the human vetoed it.
Recording it here is what stops a later conversation from spending
its budget re-discovering the same dead end. A reason is mandatory:
a rejection without a reason is useless to whoever reads it next.

Requires based_on_version from the most recent resume_task.`

export const ADD_CONSTRAINT_DESCRIPTION = `Record a rule that must hold for the rest of this task.

Call this when you learn a durable restriction — the human forbids
something, an API must stay unchanged, a dependency cannot be added.
Constraints recorded here are returned by resume_task in every later
conversation, so they survive the loss of this one.

Do not use this for one-off notes; use log_step for those.

Requires based_on_version from the most recent resume_task.`

export const COMPLETE_TASK_DESCRIPTION = `Close the task with a final, hand-over-ready summary.

Call this only when the work is genuinely finished and the human has
nothing left to check. After this call, writes to the task are
refused. Write the summary for someone who was not present: what was
done, what was decided, and what remains out of scope.

Requires based_on_version from the most recent resume_task.`

/** Rappel joint à chaque schéma d'entrée exigeant une version. */
export const BASED_ON_VERSION_DESCRIPTION =
  'The version number returned by the most recent resume_task call. ' +
  'If it no longer matches the current state, the write is refused and you must call resume_task again.'
