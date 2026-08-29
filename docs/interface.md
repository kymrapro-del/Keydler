# The interface, room by room

The [README](../README.md) shows what the product is. This is what is actually
on the page — every panel, and the reason it exists.

## What else is on the page

- **Every task is reachable**, and the list says which of them need you. The
  header lists them all and switches between them; each lives at its own
  `/t/:id`, and each carries a badge naming what is unresolved — _“1 agent is
  blocked on your decision +3 more”_ — so “which one is waiting on me?” is a
  glance, not five clicks.
- **An agent just called a tool.** When one has, the header says which tool and
  how long ago. It reports a call the page observed, never a connection: nothing
  in WebMCP tells a page an agent is present, and the wording does not pretend
  otherwise.
- **Search** across the open task and the others at once, from the box or by
  pressing `/`. It matches a rejection by its reason and a step by the content of
  its evidence, and says which. Agents get the same search as `search_task`.
- **The history of one rule.** Every rule carries a History button: what was
  reworded, when it was lifted, when it came back. It falls out of the `targetId`
  the audit already keeps for undo — the same field answering a second question
  no card was asking. The log is bounded, so when older entries have been
  dropped it says so rather than showing a short history as if it were the whole
  one — an empty history would otherwise read as “nothing happened”.
- **History** in words — _“You lifted a rule”_, _“Agent tried to record a step —
  refused — the task had changed since it was read”_. The audit trail was always
  complete; this is the screen for it.
- **Correct anything.** Rename the task, change the next action, reword a rule or
  a ruled-out approach, rename a credential or fix what it is for. All human
  writes: never refused, always audited.
- **Record a step you did yourself**, with evidence pasted whole — several lines,
  a diff, a test report. You say what the evidence _is_; the page guesses and you
  correct it, so a diff is never filed as command output. You can also attach
  evidence later to a step that was only claimed.
- **Answer what the agent is waiting on.** When an agent stops rather than guess,
  its question sits at the top of the page with the reason it is blocked. Your
  answer goes back into `resume_task`, so the next conversation reads it.
- **Archive** what is done, without deleting it. `resume_task` says so, in case
  an agent arrives on an old link.
- **Import and export.** Import never overwrites: a task already here at a
  different version is added as a copy.
- **A link that carries the log.** “Copy a link that carries this log” packs the
  whole task — gzipped through `CompressionStream`, no dependency — into the URL
  fragment. Fragments are never sent to a server, so the log goes from your
  browser to theirs and touches nothing in between. Opening it asks before
  writing anything, and says it is a copy that will not stay in step. A log too
  big for a link is refused with the size, and points at the file export, which
  has no limit.
- **Installable and offline.** A manifest and a service worker whose precache
  list is written at build time from the real, hashed asset names — an audit
  found it had been listing none of them, so offline served a blank page after
  the first visit. Verified since with the static server stopped and the network
  emulated off: an uncached fetch fails and the page still renders. When the
  network goes, the page says so — everything here is on the device.
- **Will the browser keep this?** Technical details reports whether storage is
  durable and how much room the log takes, and offers to ask the browser for
  durability. It never claims the work is safe: not durable means _may be
  cleared when space runs short_, durable means _the browser will not clear it
  on its own_ — you still can, and so can a site-data wipe. If the browser
  declines the request, the page says that too rather than doing nothing
  visible.
- **What “done” means.** A title is not a definition of done, and the next action
  is not a destination. `DONE WHEN` sits beside `NEXT` in what every agent reads,
  it is yours to write — an agent can ask for it but not set it, because the
  definition of success is the one thing the human must own — and `complete_task`
  quotes it back so the closing summary has to say whether it was reached.
- **Copy the log as text.** Most assistants have no WebMCP today. One button
  copies the exact `resume_task` output, framed with “read this before doing
  anything” and “continue this task”, ready to paste into any conversation. It is
  the same text the tool returns, not a version written for the screen.
- **Carry the rules over.** Creating a task offers to bring the rules in force
  from the one you are on. They arrive binding and attributed to you, and
  nothing else follows — not the work, not the rejections, not the history.
- **How long since anything happened.** The header says when the log was last
  written, and `resume_task` warns an agent when a notebook has sat untouched
  for a day or more, so it checks that what it is reading still holds.
- **Did the agent read before writing?** The page counts it, from the calls it
  actually observed. Every write after a read says so; a write that arrived
  before any read is called out — that agent was working from its own memory,
  not from this log. It is the product's central claim, reported as observed
  data rather than asserted.
- **Escape closes whatever is open**, and `/` reaches search. One thing closes at
  a time, and it is always the thing on screen.
- **While you were away.** Come back to the page and it lists what was written
  since you last had it in front of you — the human-side mirror of
  `what_changed`. A hidden tab counts as away, so switching to your agent and
  back is enough to trigger it.
- **Dispute what an agent claimed.** Reading evidence and only being able to
  approve it is a form with one exit. “Wrong” sits beside “Approve”, asks for
  your reason, and that reason is what every later conversation reads. Disputing
  drops the step out of the proven count, and it undoes like any other decision.
- **“Needs you”**, at the top, before you read ten cards: agents blocked on a
  decision, questions, proposals, evidence to read, work claimed with no
  evidence — counted, ordered by what it costs to miss, and linked to the card
  that holds each one. It disappears when there is nothing left.
- **Keyboard.** `/` search, `s` record a step, `n` new task, `e` change the next
  action, `?` for the list, `Esc` closes whatever is open. Nothing is captured
  while you are typing.
- **Print it.** A print stylesheet drops the buttons and the dark ground, so
  `Cmd+P` gives a hand-over sheet that reads on paper.
- **No repeating what is already written.** An agent proposing a rule, a
  rejection, a question or a request word for word identical to one already on
  the task is refused, and told so — it compares strings, not meanings, and the
  message says exactly that. It keeps the log from filling with duplicates the
  human then has to decline one by one.
- **Closing is not settling.** `complete_task` succeeds, then lists what was
  never resolved — questions nobody answered, proposals nobody decided, steps
  still claimed, steps you called wrong — and tells the agent to say so in its
  hand-over rather than imply it was all handled.
- **The tab calls you.** When something is waiting on you and the tab is in the
  background, its title carries the count — the same signal every chat app uses,
  and it costs no permission prompt.
- **Undo that.** Lifting a rule, accepting a proposal, archiving a task,
  disputing a step, renaming, rewording a rule, changing the next action — each
  is one click, so each is one click back. It undoes only your own last
  decision, only while that decision is still in force, and never reaches past
  an agent's work. An answer to a question and a logged step stay outside it: an
  agent may already have acted on the answer, and a step is a record of work,
  not a decision. Nothing is erased — the undo is a write of its own, and the
  audit entry now keeps what was replaced, so the history reads _“renamed: X →
  Y”_ rather than just _“renamed”_.
- **Filter what you searched.** When results span rules, steps, decisions and
  rejections, one button per kind narrows them, with a count each. The filter
  resets when the query changes, so a stale filter never makes a hit look like a
  miss.
- **See exactly what an agent reads.** Technical details holds the thirteen
  registered tool objects verbatim — the same descriptions and JSON schemas that
  reach an agent through WebMCP, not a summary written for the page. A reader
  with no agent to hand can check every claim in this README against the source
  of truth.
