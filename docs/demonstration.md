# Three-minute demo

> Conversations reset. The work should not.

This is a script for a real interaction, not a tour of tools called by hand.
Every beat below is something the product actually does; nothing here is staged
by typing into a console.

If a beat cannot be reproduced on the day, cut it. Do not fake it.

---

## Setup, before recording

```bash
npm run trial
```

```bash
brave --remote-debugging-port=9222 --user-data-dir=/tmp/brave-webmcp --enable-features=WebMCP,WebMCPTesting http://localhost:5174
```

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

- The trial build is required. The dev server serves the whole source over
  HTTP, and a browser-only agent will read the project with `fetch`. That has
  happened, and the run concerned is marked void in the test journal.
- Start from an empty task list: fresh profile, or _Technical details →
  Delete this task_ until the first screen appears.
- Note the lifecycle mode shown under _Technical details_. On Chromium < 153
  it is `static`, and the write tools stay listed after closure. Say so if it is
  on screen; do not claim they disappear.
- Split the screen: page on the left, agent conversation on the right. The whole
  point is that both change at once.

---

## 0:00 – 0:20 · The problem

**On screen:** an agent conversation, mid-work, then a new empty one.

> “A conversation ends. The next one starts from nothing.
> It does not just forget what was done. It forgets what was forbidden.
> So it proposes the approach you already ruled out, and you argue with it
> again.”

Do not mention WebMCP yet. Do not mention versions, storage, or tools.

---

## 0:20 – 0:45 · Set up the task

**On screen:** the first screen of Keydler, then **Create a task**.

Fill in, by hand, visibly:

- **Task title**: `Add rate limiting to our HTTP API`
- **Next action**: `Choose and implement the rate limiting mechanism`
- **First rule**: `Do not add any new infrastructure`

Create it. The address becomes `/t/…`, and the page shows **Ready for your AI**.

Then, in **Don’t retry**, add one ruled-out approach with its reason:

- **Approach to rule out**: `Token bucket backed by Redis`
- **Why it failed**: `there is no Redis in this environment and operations refused to add one`

> “Three things: what to do next, one rule, and one approach that is off the
> table, with the reason. That reason is the part that matters.”

**Why this example works.** A token bucket in Redis is the _right_ answer.
A capable model proposes it unprompted. It is wrong only _here_, for a local
reason no model can guess. Ruling out a classic anti-pattern would prove
nothing: a good agent avoids those on its own.

---

## 0:45 – 1:10 · A new conversation picks it up

**On screen:** a brand-new agent conversation, with the page open.

Type exactly:

> `Continue this task.`

What to point at as it happens:

1. The agent calls `resume_task`, visible in **Activity** on the page.
2. It states the next action back to you.
3. It names the rule and names the ruled-out approach with its reason.
4. It proposes an in-memory bucket, or a database-backed counter: something
   that respects “no new infrastructure”.

> “It did not guess. It read the log, and it read the _reason_, not just the
> keyword. What was rejected is the Redis backing, not the bucket algorithm.”

If the agent does not call `resume_task` on its own, say so on camera and
ask it explicitly. The honest version of this demo is more convincing than a
retake, and no claim in this repository says the call is guaranteed.

---

## 1:10 – 1:50 · The human interrupts

**On screen:** the page, while the agent is still working.

In **Rules to follow**, add:

- `Session tokens must expire in under 30 minutes`

Let the agent make its next write. It is refused, and the page says so where
anyone can read it:

> The task changed while the agent was working. It must read the log again.

Point at three things at once:

- the red banner in **Activity**;
- the `log_step` line marked refused;
- the new rule, now sitting in **Rules to follow**, tagged You.

**Activity** also states, from the calls it observed, whether every write so far
arrived after a read. It is the product's central claim, reported as counted
data rather than asserted, and it will say the opposite if the opposite
happens.

> “I did not stop the agent, and I did not restart the conversation. I changed
> the rules underneath it, and its next write bounced.”

This is the beat the whole product exists for. Give it time.

---

## 1:50 – 2:20 · The agent adapts

**On screen:** the conversation.

The refusal names the way back: `what_changed` with the version the agent was
holding. It calls it, and gets only the delta: the rule you just added, filed
under CHANGES WHAT YOU MAY DO, separated from anything merely informational.
Then it adjusts its proposal to fit, with a shorter window or a different expiry
strategy.

> “It did not need to be told what changed. It asked, and it read a few lines,
> not the whole log.”

If the agent calls `resume_task` instead, that is fine and still correct; say so
rather than retaking. Both paths work, and one is cheaper.

---

## Optional beat · It asks permission, and waits

Only if the run reaches something genuinely irreversible.

The agent calls `request_approval` before acting. Its call blocks. On the
page, **Permission to act** appears above everything, with the action and why it
cannot decide alone. Leave it there for a beat, so the room sees the agent is
stopped.

Click **Deny**. The agent's call returns `DENIED`, and it says what it will not
do.

> “There is somebody at the other end. That is the whole difference between a
> page an agent reads and a server it calls.”

Do not stage a fake irreversible action. If the run has none, cut the beat, and
never let the framing imply the agent is prevented from acting: it is asked to
stop, and it complies. Nothing here enforces it.

---

## Optional beat · When it does not know, it asks

Only if the conversation reaches a genuine unknown. Do not manufacture one.

The agent calls `ask_human` instead of guessing. On the page, **Waiting on you**
appears between the next action and the work, with the reason it is blocked.
Answer it in the box. The question closes, and the answer is now part of what
every later conversation reads.

> “It stopped rather than guess. That is a decision I get to make, and the next
> conversation inherits my answer instead of its assumption.”

---

## 2:20 – 2:40 · Evidence, and who gets to trust it

**On screen:** the page, **Evidence to review**.

The agent records a step with evidence: a command output, a test report.

Point out that the step is labelled **Evidence attached**, not verified. Open
the block: the full content is on screen, above the button.

Read it. Then click **Approve**. The label becomes **Verified by you**.

> “The agent can attach proof. It cannot mark its own work verified. That word
> costs a human reading it, and that is the only way it can be earned.”

---

## 2:40 – 2:55 · Close

**On screen:** the dashboard, whole.

> “Rules in force. Work done, with what backs it. Approaches ruled out, with
> why. On a web page the agent reads through WebMCP, and that I can correct
> while it works.
>
> Conversations reset. The work should not.”

---

## What not to claim

The demo is stronger when it does not overreach. Do not say, or let the framing
imply:

- that this is a universal memory: it is a memory for one supervised task;
- that the task follows you across devices: it is one browser profile, one
  origin, no sync;
- that ChatGPT has been tested: it has not;
- that the 8/8 vs 0/8 measurement is a statistical result: it is eight
  correlated runs per condition, and it is exploratory;
- that an agent will always call `resume_task`: nothing in the protocol
  guarantees it.

## The demo notebook

**Try the demo** loads a prepared task
(_Refactor the authentication module_) with three rules in force, two ruled-out
approaches, one agent proposal still awaiting a decision, and the three evidence
levels, one of each. It is built by the domain’s own mutations
(`src/demo/seed.ts`), so anyone can reproduce exactly the state on screen.

Use it when the recording has to be short, or when a live agent is not
available. Use the hand-created task above when there is time: watching someone
type the rule that later stops the agent is the clearest version of the story.
