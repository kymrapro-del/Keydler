/**
 * Chrome recommande 500 caractères par description d'outil et 150 par description de
 * paramètre : pas des limites dures, mais il y en a treize à lire d'un coup. Une
 * description instruit, le README explique ; `test/budgets-webmcp.test.ts` tient ces bornes.
 */

export const RESUME_TASK_DESCRIPTION = `Persistent, human-supervised checkpoint for the current task. It holds:
binding constraints, work done with its evidence, ruled-out approaches,
the next action, and unapproved proposals kept separate.

Call this BEFORE doing any work if you do not know the state: at the
start of a new conversation, after any context loss, and whenever a
write is refused as stale.

It answers for ONE task, named by TASK ID in the reply. If that is not
the task you meant, say so rather than working on it.`

export const READ_DETAIL_DESCRIPTION = `Read the parts of the task record that resume_task had to cut.

Call this when the summary is not enough: to re-read evidence, to see a
rejection's whole reason, to page through older work, or to check what
is proposed but not approved.

Ask for one section at a time. Pages are small; the reply says how many
entries remain and the offset to continue from. To get one entry whole,
including evidence that pages truncate, pass its id.

Read-only: this never changes the task, and needs no version.`

export const SEARCH_TASK_DESCRIPTION = `Search this task's record for a word or phrase.

Call this before trying something, to find out whether it has already
been tried here and what came of it. It looks through the steps and
their evidence, the rules, the ruled-out approaches, the decisions, and
the history of refused writes.

Finding nothing does not prove the work was never attempted: the log
may use other words. Say so rather than concluding it is untried.

Read-only: this never changes the task, and needs no version.`

export const WHAT_CHANGED_DESCRIPTION = `List what has been written to this task since a version you hold.

Call this when a write is refused as stale, and whenever you come back
to a task you read earlier. It answers: what did the human do while I
was working?

The reply separates what changes what you may do (a rule added, a
proposal accepted, a question answered) from what merely happened. If
the log had to drop older entries it says so; fall back to resume_task.

Read-only: this never changes the task.`

export const LOG_STEP_DESCRIPTION = `Record one completed step in the task's log, with its evidence.

Call this immediately AFTER finishing a unit of work: a file changed, a
command run, a test run. Do not batch several steps into one call, and
do not call it for work you only intend to do.

Attach evidence when you have any: a step without it is recorded as merely
claimed. Evidence you attach is recorded as attached, not as verified.
Only a human who reads it can mark it verified. Do not describe your own
output as confirmed.`

export const ADD_DECISION_DESCRIPTION = `Record a choice and the reasoning behind it.

Call this whenever you pick one option over another for a reason that
would not be obvious from the code alone: a trade-off, a constraint you
worked around, an assumption you made. This is the "why", which every
summary loses first.`

export const REJECT_APPROACH_DESCRIPTION = `Propose that an approach was tried and must not be retried.

Call this the moment an approach is ruled out: it failed, it broke
something, it lost a benchmark. Recording it stops a later conversation
re-discovering the same dead end. A reason is mandatory: a rejection
without one is useless to whoever reads it next.

What you record is a PROPOSAL, shown to later agents as a proposal and
not a rule until a human approves it. You cannot forbid an approach on
your own authority.`

export const ADD_CONSTRAINT_DESCRIPTION = `Propose a rule that should hold for the rest of this task.

Call this when you learn a durable restriction: an API must stay
unchanged, a dependency cannot be added. resume_task returns them in
every later conversation, so they survive the loss of this one.

What you record is a PROPOSAL, shown separately from the binding
constraints until a human approves it. A rule the human states is
binding at once; a rule you infer is not.

Do not use this for one-off notes; use log_step for those.`

export const ASK_HUMAN_DESCRIPTION = `Record a question only the human can answer, and why it blocks you.

Call this the moment you hit a decision you cannot make from the code or
the record: a business rule, or a choice between two designs.

Do NOT guess and carry on: a guess recorded as work is inherited as fact
by the next conversation. Record the question, do the parts that do not
depend on it, and say what is blocked.

It stays open until answered, and resume_task shows it to every later
conversation, so ask once.`

export const ATTACH_EVIDENCE_DESCRIPTION = `Attach evidence to a step you already logged without any.

Call this when proof arrives after the fact: a suite that finished, a
build that completed, a link that became available. It turns a step
recorded as merely claimed into one with evidence attached.

It does not mark the step verified: only a human who reads the evidence
can do that. A step that already carries evidence is refused rather than
overwritten. Record a new step instead.`

export const SET_NEXT_ACTION_DESCRIPTION = `Change the single next action, without recording work.

Call this when the next action changes but nothing was completed: you
learned something that redirects the task, or you are ending a
conversation and want the next one to start in the right place.

If you also finished a unit of work, use log_step and set its next field
instead: one call, and the change is tied to what caused it.`

export const REQUEST_APPROVAL_DESCRIPTION = `Ask the human for permission to act outside this log, and wait.

Call this BEFORE an action you cannot undo and they would want a say in:
running a migration, deploying, deleting data, sending anything to
anyone. Describe exactly what you are about to do, in their terms.

This call blocks. A human clicks allow or deny and you get their
decision. If nobody answers in time, it returns NO ANSWER.

NO ANSWER IS NOT APPROVAL. Treat it exactly as a refusal, say so, and do
something else.`

export const COMPLETE_TASK_DESCRIPTION = `Close the task with a final, hand-over-ready summary.

Call this only when the work is genuinely finished and the human has
nothing left to check. After this call, writes to the task are refused.
Write the summary for someone who was not present: what was done, what
was decided, and what remains out of scope.`

/**
 * Le protocole complet est enseigné là où il sert : le bloc WRITE PROTOCOL de
 * `resume_task`, et le texte des refus. Ici, on dit seulement quoi mettre.
 */
export const BASED_ON_VERSION_DESCRIPTION =
  'The version from your most recent resume_task. If the task has moved since, ' +
  'the write is refused. Call resume_task again.'

export const MUTATION_ID_DESCRIPTION =
  'A fresh unique id for THIS write. If you get no reply, retry with the SAME ' +
  'mutation_id and arguments: the write happens once. Never reuse one.'
