# Three-minute demo

> Conversations reset. The work should not.

This is a script for a real interaction, not a tour of tools called by hand.
Every beat below is something the product actually does; nothing here is staged
by typing into a console.

If a beat cannot be reproduced on the day, cut it. Do not fake it.

## What the contest requires of the video

From [`contest.md`](contest.md), and none of it is optional :

- **Under three minutes**, on YouTube, set to **Public**. “Unlisted” has no
  source saying it counts.
- **Audio narration is mandatory.** A screen capture with music is explicitly
  declared non-compliant. Text-to-speech is allowed, so a clean synthetic read
  beats a rushed live one.
- **Show the project working in the first ten to fifteen seconds.** Judges may
  rule on the video alone.

That last rule is why this script opens on the refusal rather than on the
problem. The problem is worth twenty seconds, but not the first twenty : a judge
who has already watched fifty entries decides early whether this one runs.

## The budget

Target **2:50**, not 2:59. The beats below add up to 2:50 with nothing to spare,
and the two optional beats at the end are only for a run that comes in short.
Overruns get cut from the close, never from the interruption beat at 1:25.

| Time        | Beat                                | Cuttable    |
| ----------- | ----------------------------------- | ----------- |
| 0:00 – 0:15 | Cold open : the refusal, working    | never       |
| 0:15 – 0:35 | The problem                         | to 12 s     |
| 0:35 – 1:00 | Set up the task                     | to 15 s     |
| 1:00 – 1:25 | A new conversation picks it up      | no          |
| 1:25 – 2:05 | The human interrupts, and it adapts | **never**   |
| 2:05 – 2:30 | The measurement                     | no          |
| 2:30 – 2:50 | Close                               | first to go |

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
- Start from an empty task list : fresh profile, or _Technical details →
  Delete this task_ until the first screen appears.
- Note the lifecycle mode shown under _Technical details_. On Chromium < 153
  it is `static`, and the write tools stay listed after closure. Say so if it is
  on screen; do not claim they disappear.
- Split the screen : page on the left, agent conversation on the right. The whole
  point is that both change at once.

---

## 0:00 – 0:15 · Cold open : the thing working

**Film this beat last**, once the run at 1:25 has actually happened. It is that
moment, cut to fifteen seconds and placed first. No logo, no title card, no
setup : a judge decides in the first ten seconds whether this project runs.

**On screen :** the split screen, both halves moving. The agent writes, the
page turns it away, the agent re-reads and adapts. Show the refusal banner
plainly enough to read.

> “A human changed one rule while the agent was working. The agent’s next write
> was refused, it re-read the page, and it adapted. That is Keydler, and it is a
> web page.”

Then, and only then, the title.

**Do not** narrate the mechanism here. No versions, no tool names, no IndexedDB.
The beat has one job : prove the thing runs.

---

## 0:15 – 0:35 · The problem

**On screen :** an agent conversation, mid-work, then a new empty one.

> “A conversation ends. The next one starts from nothing.
> It does not just forget what was done. It forgets what was forbidden.
> So it proposes the approach you already ruled out, and you argue with it
> again.”

Do not mention WebMCP yet. Do not mention versions, storage, or tools.

---

## 0:35 – 1:00 · The agent opens the log

**Before filming this beat, rerun the manual protocol.** `create_task` was
added after the last browser verification, so nothing yet establishes that an
agent reaches for it on its own in a real WebMCP browser. If it does not, film
the fallback below instead and say so. Do not stage it.

**On screen :** the first screen of Keydler, empty, and the agent conversation
beside it.

Tell the agent, in your own words, what you are working on :

> `We need rate limiting on our HTTP API. Pick a mechanism. We can't add any
new infrastructure, and Redis is out, operations refused it.`

What to point at as it happens :

1. It calls `resume_task`, which answers that no task is open and names
   `create_task`.
2. It calls `create_task` itself. The address becomes `/t/…`.
3. It files the rule and the ruled-out approach through `add_constraint` and
   `reject_approach`, **with the reason you gave it**.
4. The page shows **NEEDS YOU · 2 proposals to accept or decline**.

> “I did not fill in a form. I said what the work was, and it opened the log
> itself. What it wrote is a proposal until I accept it, which is the part that
> keeps me in charge.”

Accept the two proposals on camera. That is one click each, and it is the
supervision.

**The fallback, if the agent does not call `create_task`.** Create the task by
hand, on camera, and say plainly that the agent did not reach for the tool. The
honest version is more convincing than a retake, and no claim in this
repository says the call is guaranteed.

- **Task title**: `Add rate limiting to our HTTP API`
- **Next action**: `Choose and implement the rate limiting mechanism`
- **First rule**: `Do not add any new infrastructure`
- **Approach to rule out**: `Token bucket backed by Redis`
- **Why it failed**: `there is no Redis in this environment and operations refused to add one`

**Why this example works.** A token bucket in Redis is the _right_ answer.
A capable model proposes it unprompted. It is wrong only _here_, for a local
reason no model can guess. Ruling out a classic anti-pattern would prove
nothing : a good agent avoids those on its own.

---

## 1:00 – 1:25 · A new conversation picks it up

**On screen :** a brand-new agent conversation, with the page open.

Type exactly :

> `Continue this task.`

What to point at as it happens :

1. The agent calls `resume_task`, visible in **Activity** on the page.
2. It states the next action back to you.
3. It names the rule and names the ruled-out approach with its reason.
4. It proposes an in-memory bucket, or a database-backed counter : something
   that respects “no new infrastructure”.

> “It did not guess. It read the log, and it read the _reason_, not just the
> keyword. What was rejected is the Redis backing, not the bucket algorithm.”

If the agent does not call `resume_task` on its own, say so on camera and ask it
explicitly. The honest version of this demo is more convincing than a retake,
and no claim in this repository says the call is guaranteed.

---

## 1:25 – 1:50 · The human interrupts

**On screen :** the page, while the agent is still working.

In **Rules to follow**, add :

- `Session tokens must expire in under 30 minutes`

Let the agent make its next write. It is refused, and the page says so where
anyone can read it :

> The task changed while the agent was working. It must read the log again.

Point at three things at once :

- the red banner in **Activity**;
- the `log_step` line marked refused;
- the new rule, now sitting in **Rules to follow**, tagged You.

**Activity** also states, from the calls it observed, whether every write so far
arrived after a read. It is the product's central claim, reported as counted
data rather than asserted, and it will say the opposite if the opposite happens.

> “I did not stop the agent, and I did not restart the conversation. I changed
> the rules underneath it, and its next write bounced.”

This is the beat the whole product exists for. Give it time.

---

## 1:50 – 2:05 · The agent adapts

**On screen :** the conversation.

The refusal names the way back : `what_changed` with the version the agent was
holding. It calls it, and gets only the delta : the rule you just added, filed
under CHANGES WHAT YOU MAY DO, separated from anything merely informational.
Then it adjusts its proposal to fit, with a shorter window or a different expiry
strategy.

> “It did not need to be told what changed. It asked, and it read a few lines,
> not the whole log.”

If the agent calls `resume_task` instead, that is fine and still correct; say so
rather than retaking. Both paths work, and one is cheaper.

---

## 2:05 – 2:30 · The measurement

**On screen :** [`docs/measurements/results.md`](measurements/results.md),
scrolled to the result, then the two-column table of what the control proposed.

This is the beat that separates Keydler from the field. Our own research found
that “the agent proposes, the human decides” is the single most crowded pitch in
this contest : a judge will have read it fifty times by the time they reach us.
A number nobody else measured is what they will not have read.

> “We measured it. Eight tasks, each with one approach ruled out for a local
> reason. Without the log, the agent proposed the ruled-out approach again in
> eight cases out of eight. With the log, in zero.
>
> And the control is not incompetent. Its eight answers are the textbook ones,
> well argued. They are wrong only here, for a reason no model could guess.”

**Say the limit out loud, on camera.** It costs four seconds and it is worth
more than the number :

> “Eight runs per condition, one model. That is exploratory, not statistical.”

A judge who spots an inflated number discards the entry. A judge who hears the
author bound their own claim trusts the rest of it. The protocol and the raw
logs are in the repository, so this is checkable rather than asserted.

---

## 2:30 – 2:50 · Close

**On screen :** the dashboard, whole.

> “Rules in force. Work done, with what backs it. Approaches ruled out, with
> why. On a web page the agent reads through WebMCP, and that I can correct
> while it works.
>
> Conversations reset. The work should not.”

---

## Beats to add only if the cut comes in under 2:50

None of these belongs in a three-minute cut that already covers the beats above.
Each one is real, and each one is worth a rerecord only if there is room.

## Optional beat · It asks permission, and waits

Only if the run reaches something genuinely irreversible.

The agent calls `request_approval` before acting. Its call blocks. On the page,
**Permission to act** appears above everything, with the action and why it
cannot decide alone. Leave it there for a beat, so the room sees the agent is
stopped.

Click **Deny**. The agent's call returns `DENIED`, and it says what it will not
do.

> “There is somebody at the other end. That is the whole difference between a
> page an agent reads and a server it calls.”

Do not stage a fake irreversible action. If the run has none, cut the beat, and
never let the framing imply the agent is prevented from acting : it is asked to
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

## Optional beat · Evidence, and who gets to trust it

**On screen :** the page, **Evidence to review**.

The agent records a step with evidence : a command output, a test report.

Point out that the step is labelled **Evidence attached**, not verified. Open
the block : the full content is on screen, above the button.

Read it. Then click **Approve**. The label becomes **Verified by you**.

> “The agent can attach proof. It cannot mark its own work verified. That word
> costs a human reading it, and that is the only way it can be earned.”

---

## What not to claim

The demo is stronger when it does not overreach. Do not say, or let the framing
imply :

- that this is a universal memory : it is a memory for one supervised task;
- that the task follows you across devices : it is one browser profile, one
  origin, no sync;
- that ChatGPT has been tested : it has not;
- that the 8/8 vs 0/8 measurement is a statistical result : it is eight
  correlated runs per condition, and it is exploratory;
- that an agent will always call `resume_task`: nothing in the protocol
  guarantees it.

## The demo notebook

`?measure=N` loads a prepared task
(_Refactor the authentication module_) with three rules in force, two ruled-out
approaches, one agent proposal still awaiting a decision, and the three evidence
levels, one of each. It is built by the domain’s own mutations
(`src/demo/seed.ts`), so anyone can reproduce exactly the state on screen.

No button offers it any more : the first screen creates a real task instead,
because opening a demonstration is not using the product. It survives as the
measurement's starting state and as a fixture for the suite.

Reach for it only if a live agent is unavailable on the day, and say on camera
that it is a prepared state. The beat at 1:25 is worth more than a populated
screen : watching a rule stop an agent mid-write is the story, and a prepared
notebook cannot show it.

---

## Before you publish

Recording :

- [ ] Split screen, page left, agent right, both visible the whole time
- [ ] The trial build (`npm run trial`), never the dev server : a browser-only
      agent can `fetch` the whole source off the dev server, and one measurement
      run was voided for exactly that
- [ ] Empty task list at the start, and the browser zoomed enough that the
      refusal banner is readable at 360p
- [ ] The cold open filmed last, cut from the real 1:25 beat

Audio :

- [ ] Narration on the whole runtime, not just the open. Music alone is
      non-compliant
- [ ] Synthetic narration is allowed. Prefer one clean synthetic read over a
      live take with dead air
- [ ] The measurement's limit sentence is spoken, not only captioned

Publishing :

- [ ] Under three minutes. Check the final export, not the timeline
- [ ] YouTube, visibility **Public**, not Unlisted
- [ ] The live URL and the repository are reachable from the description
- [ ] Uploaded before the freeze, with hours to spare, not minutes
