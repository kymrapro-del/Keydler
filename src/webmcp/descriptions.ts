export const RESUME_TASK_DESCRIPTION = `Persistent, human-supervised checkpoint for the current task.
This page holds the canonical task state: binding constraints,
completed work with its evidence, rejected approaches, and the next
action. It also holds proposals written by earlier agents, kept
separate because no human has approved them.

Call this tool BEFORE doing any work if you do not already know
the current task state — including at the start of a new
conversation, after any context loss or summarization, and
whenever a write is refused as stale.

It answers for ONE task, named by TASK ID in the reply. If that id
is not the task you meant, say so rather than working on it.

The reply may list credentials by name. You can refer to one as
\${name}; no tool here returns a value, and you are not expected to
know one.`

export const READ_DETAIL_DESCRIPTION = `Read the parts of the task record that resume_task had to cut.

Call this when the summary is not enough: to re-read evidence you or
another agent attached, to see the whole reason an approach was
rejected, to page through work older than the last few steps, or to
check what has been proposed but not approved.

Ask for one section at a time. Pages are small on purpose; the reply
tells you how many entries remain and the offset to continue from.
To get one entry whole — including evidence that pages truncate —
pass its id.

The "credentials" section lists every credential the human sealed for
this task: the name to write as \${name}, and what it is for. It never
returns a value, and no tool here does.

Read-only: this never changes the task, and needs no version.`

export const SEARCH_TASK_DESCRIPTION = `Search this task's record for a word or phrase.

Call this before trying something, to find out whether it has already
been tried here and what came of it. It looks through the steps and
their evidence, the rules, the ruled-out approaches, the decisions,
and the history of refused writes.

Prefer this to paging read_task_detail when you have a term to look
for; use read_task_detail afterwards to read a match in full.

Finding nothing does not prove the work was never attempted — the log
may use other words. Say so rather than concluding it is untried.

Read-only: this never changes the task, and needs no version.`

export const WHAT_CHANGED_DESCRIPTION = `List what has been written to this task since a version you hold.

Call this when a write is refused as stale, and whenever you come back
to a task you read earlier. It answers the only question that matters
then — what did the human do while I was working? — for a fraction of
what a full resume_task costs.

The reply separates what changes what you may do (a rule added or
lifted, a proposal accepted, a question answered) from what merely
happened. If the log had to drop older entries, it says so instead of
looking complete; fall back to resume_task then.

Read-only: this never changes the task.`

export const LOG_STEP_DESCRIPTION = `Record one completed step in the task's watch log, with its evidence.

Call this immediately AFTER finishing a unit of work — a file
changed, a command run, a test suite executed. Do not batch several
steps into one call, and do not call it for work you only intend to
do. Attach evidence whenever you have any: a step without evidence
is recorded as merely claimed, and a human will have to re-check it.

Evidence you attach is recorded as attached, not as verified. Only a
human who reads it can mark it verified. Do not describe your own
output as confirmed.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const ADD_DECISION_DESCRIPTION = `Record a choice and the reasoning behind it.

Call this whenever you pick one option over another for a reason
that would not be obvious from the code alone — a trade-off, a
constraint you worked around, an assumption you made. This is the
"why", which every summary loses first.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const REJECT_APPROACH_DESCRIPTION = `Propose that an approach was tried and must not be retried, with the
reason it failed.

Call this the moment an approach is ruled out — it failed, it broke
something, it was benchmarked and rejected. Recording it here is what
stops a later conversation from spending its budget re-discovering
the same dead end. A reason is mandatory: a rejection without a
reason is useless to whoever reads it next.

What you record is a PROPOSAL. It is shown to later agents as an
agent proposal, not as a rule, until a human approves it. You cannot
forbid an approach on your own authority — if you could, one wrong
call would silently close off the right answer for every conversation
that follows.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const ADD_CONSTRAINT_DESCRIPTION = `Propose a rule that should hold for the rest of this task.

Call this when you learn a durable restriction — an API must stay
unchanged, a dependency cannot be added, a file must not be touched.
Constraints are returned by resume_task in every later conversation,
so they survive the loss of this one.

What you record is a PROPOSAL, shown separately from the binding
constraints until a human approves it. A rule the human states is
binding from the moment they enter it; a rule you infer is not.

Do not use this for one-off notes; use log_step for those.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const ASK_HUMAN_DESCRIPTION = `Record a question only the human can answer, and why it blocks you.

Call this the moment you hit a decision you cannot make from the code
or the task record: a business rule, a credential you do not have, a
choice between two acceptable designs, a measurement you cannot take.

Do NOT guess and carry on. A guess recorded as work is worse than a
question recorded as a question: the next conversation inherits it as
fact. Record the question, do the parts that do not depend on it, and
say plainly what is blocked.

The question stays open in the task until a human answers it, and
resume_task shows it to every later conversation — so asking it once
is enough. Read the answers before asking again.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const ATTACH_EVIDENCE_DESCRIPTION = `Attach evidence to a step you already logged without any.

Call this when proof arrives after the fact — a suite that finished,
a build that completed, a link that became available. It turns a step
recorded as merely claimed into one with evidence attached.

It does not mark the step verified: only a human who reads the
evidence can do that. A step that already carries evidence is refused
rather than overwritten — record a new step instead.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const SET_NEXT_ACTION_DESCRIPTION = `Change the single next action, without recording work.

Call this when the next action changes but nothing was completed —
you learned something that redirects the task, or you are ending a
conversation and want the next one to start in the right place.

If you also finished a unit of work, use log_step and set its next
field instead: one call, and the change is tied to what caused it.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const COMPLETE_TASK_DESCRIPTION = `Close the task with a final, hand-over-ready summary.

Call this only when the work is genuinely finished and the human has
nothing left to check. After this call, writes to the task are
refused. Write the summary for someone who was not present: what was
done, what was decided, and what remains out of scope.

Requires based_on_version from the most recent resume_task, and a
mutation_id.`

export const BASED_ON_VERSION_DESCRIPTION =
  'The version number returned by the most recent resume_task call. ' +
  'If it no longer matches the current state, the write is refused and you must call resume_task again.'

export const MUTATION_ID_DESCRIPTION =
  'A unique id you generate for THIS write, e.g. a UUID. ' +
  'If you do not get a reply — the call was cancelled, the page was closed, the answer was lost — ' +
  'retry with the SAME mutation_id and the same arguments: the write happens once and you get the original reply back. ' +
  'Never reuse one for a different write, and never invent a new one to retry an old one.'
