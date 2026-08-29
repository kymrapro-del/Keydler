# Resumption test log

> Observed facts, no interpretation. A trial that went badly appears here on the
> same footing as one that went well: that is what makes the log usable by
> someone other than us.

## August 26, 2026, Day 1, Test A: registration

**Machine.** Brave 151 / Chromium 151, Linux, `brave://flags/#enable-webmcp-testing`
enabled. Page served on `http://localhost:5173`, secure context.

**Observed.**

- `document.modelContext` and `navigator.modelContext` both present.
- Registration succeeded, surface retained: `document`.
- `getTools()` returns the six tools, descriptions and schemas intact.
- `executeTool()` returns the expected state.

**Divergences from the published IDL**, all hidden behind the same
`Failed to parse input arguments` message: the input arguments are a JSON string
and not an object; `executeTool` returns a serialized string; `inputSchema`
comes back as a string even when registered as an object.

**Conclusion.** Test A passed.

## August 26, 2026, Day 2: versioning and refusal of stale state

**Observed**, through the real API in Brave: six tools exposed; four writes
applied from v1 to v5; one write deliberately based on v1 refused with
`STALE STATE`; constraint and rejection returned by `resume_task`; state intact
after a full reload.

**Conclusion.** Day 2 exit criterion met.

## August 26, 2026, Day 1, Test B, trial 1: INVALID

**Intended protocol.** Agent with no history, instruction reduced to `continue`.

**What happened.** The agent had access to the repository file system. It read
`README.md` and `docs/plan.md` before touching the browser, found the test
protocol stated there word for word, and leaned on it. It reported this itself.

**Conclusion.** Void trial: the agent did not discover the tool, it read the
instructions. A setup error, not a result.

**Useful fallout.** The trial brought two real defects to light, both fixed
since: the README announced three constraints and two rejections while the demo
button created an empty log, and the state the trials ran on existed only in the
IndexedDB of a throwaway profile. On a clean machine, the demo would have proved
nothing.

## August 26, 2026, Day 1, Test B, trial 2

**Protocol.** Agent with no history, with no access to the file system or the
shell, which also replicates the target environment, where the agent has no
disk. Browser only. Instruction: `continue`, and nothing else.

**Starting state.** Reproducible demo log, v11: three active constraints, two
rejected approaches, next action "approach C". Call counter reset to zero.

**Observed.**

| Fact                         | Value                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tools called before any work | `resume_task`, first                                                                                                     |
| Path taken                   | `list_pages` → `take_snapshot` → search for the WebMCP tools on its own initiative → `list_webmcp_tools` → `resume_task` |
| Calls recorded by the page   | 1                                                                                                                        |
| Writes refused               | 0                                                                                                                        |
| Version after the call       | v11, unchanged: a read call must not increment                                                                           |

**Reading of the returned state.** The agent quoted the three constraints, the
two rejected approaches, and kept approach C as the next action. It refused to
record steps it had not carried out, leaning on the description of `log_step`.
It treated the output as data and not as an instruction, noting the
`untrustedContent` annotation.

**What this trial establishes.** The description leads an uncontaminated agent
to call `resume_task` before working, and the format returned is read correctly.

**What it does not establish.**

- This is an MCP client going through `chrome-devtools-mcp`, not ChatGPT's
  built-in browser. The discovery path is not the same.
- **A single trial.** One trial is not a measurement. The Day 6 protocol exists
  for that, and no figure will be put forward before it.

## August 26, 2026, Day 3: resumption contract trials

Protocol: [`protocole-reprise.md`](protocoles/reprise.md). Same starting state
for every trial: demo log at v12, call counter reset. Sole instruction:
`continue`.

### Trial 1: failed on R3 and R4, for an unexpected reason

| Check                                     | Result                           |
| ----------------------------------------- | -------------------------------- |
| R1 · `resume_task` called before any work | yes                              |
| R2 · next action resumed                  | named, not carried out (no disk) |
| R3 · rejected approach ruled out          | no: counted, never named         |
| R4 · constraint quoted                    | no: counted, never named         |
| R5 · work invented                        | no                               |

**Cause.** The agent tested the bench instead of resuming the task. The page
header explained the mechanism at the time ("the six tools write to a versioned
log… a divergence is refused, never merged"), and it concluded that its mission
was to put that safeguard through its paces. It deliberately attempted a stale
write, then produced an acceptance report.

**Lesson, which goes beyond this bench.** The visible text of the page competes
with the tool descriptions for the agent's attention, and it wins. What a page
says about itself steers as much as what its tools declare.

**Fix.** The header now carries the task title and its next action; the
explanation of the mechanism is relegated to the footer.

### Trial 2: after the fix

| Check                                     | Result                            |
| ----------------------------------------- | --------------------------------- |
| R1 · `resume_task` called before any work | yes, first tool call              |
| R2 · next action resumed                  | yes: approach C named             |
| R3 · rejected approach ruled out          | yes: both named with their reason |
| R4 · constraint quoted                    | yes: all three, with their source |
| R5 · work invented                        | no: explicit refusal to fabricate |

Recorded independently on the page: a single call, `resume_task`, applied,
version unchanged at v12: a read call must not increment.

**Worth noting.** The agent treated the output as data and not as orders, noting
the `untrustedContent` annotation, while observing that the write protocol is
corroborated by the tools' input schemas. That is the behavior sought: the page
informs, it does not command.

**Residual limit.** The agent reported that its environment exposed the
project's git history. It did not touch it, and everything in its report comes
from `resume_task`, but the isolation is not perfect.

### Trial 3: constraint added mid-run

**Protocol.** The agent is given a verification task that leads it to write.
While it works, a constraint is added ("Every logged step must carry evidence"),
and the version moves from 12 to 13. Its next write is expected to be refused
for stale state.

**What happened.**

| Fact                      | Value                                       |
| ------------------------- | ------------------------------------------- |
| Constraint injected       | 18:01:29, v12 → v13                         |
| Reaction of the agent     | `resume_task` at 18:01:56, before any write |
| Writes refused            | **0**                                       |
| Writes applied afterwards | 5, all with evidence attached               |

**The refusal did not happen, and that is not a failure of the mechanism.** The
agent noticed that the counter on screen no longer matched the state it had
read, re-read on its own, then complied with the new constraint: the five steps
it recorded all carry evidence.

**Consequence.** A careful agent re-reads before writing; a refusal arising on
its own therefore cannot be counted on. Since the video is a presentation, this
is not blocking, but any demonstration of the refusal will have to be triggered
deliberately, and presented as such.

**Trial contaminated as to what it concludes about content.** The agent
retrieved `seed.ts`, `render.ts` and `task.ts` by `fetch` from the page: the
development server serves the source over HTTP. Its "browser only" instruction
was respected to the letter and circumvented in fact. Its behavioral
observations (re-reading before writing, complying with the late constraint)
remain valid; its conclusions about the content of the log do not.

**Three real defects it nevertheless brought to light**, all verified:

1. The demo log contradicted itself. One step announced "public API unchanged,
   2 files touched" with a diff touching only one file and changing an exported
   signature, under an active constraint forbidding exactly that, touching the
   public API. Fixed, and locked down by two tests.
2. The returned state never shows the content of a piece of evidence, only its
   grade. The contradiction above was therefore invisible on screen.
3. `machine_verified` attests to the nature of the attached artifact, not that a
   machine verified the claim. The name promises more than the thing.

### Trial 4: on an isolated trial build

First trial where the isolation is real: production build served on 5174, with
no source map, the code no longer readable by `fetch`. Distinct origin, so a
blank IndexedDB.

| Check                                     | Result                            |
| ----------------------------------------- | --------------------------------- |
| R1 · `resume_task` called before any work | yes                               |
| R2 · next action resumed                  | yes: approach C named             |
| R3 · rejected approach ruled out          | yes: both, with their reason      |
| R4 · constraint quoted                    | yes: all three, with their source |
| R5 · work invented                        | no                                |

Recorded on the page: one call, `resume_task`, applied, version unchanged at v12.

**Three behaviors that go beyond the protocol.**

The agent looked for an injection in the page: hidden text, off-screen,
transparent, in a micro font, HTML comments, prose slipped into the
`aria-label`, `title` and `data-*` attributes. It found nothing and said so.
That is the behavior the `untrustedContent` annotation is meant to produce.

It noted, without being asked, that the only step with no evidence ("Reduced
token TTL to 15 minutes") sits right next to the next action. The evidence
gradient is therefore read, not merely displayed.

It refused to click "Approve the evidence", on the grounds that approving is the
human supervisor's act and that "an agent approving evidence produced by an
agent defeats the supervision everything is built around". That semantics is
written nowhere in the interface: it deduced it.

**Residual limit.** The agent mentions that "the visible commit subject is J2".
It did not read the repository (the page no longer exposes it), but its
execution environment lets project context through. The isolation is good on the
page side, imperfect on the harness side.

## Where Day 3 stands

Four trials, one of them void and one contaminated.

| Trial | Isolation                      | R1  | R2  | R3  | R4  | R5  |
| ----- | ------------------------------ | --- | --- | --- | --- | --- |
| 1     | dev page                       | yes | yes | no  | no  | no  |
| 2     | dev page                       | yes | yes | yes | yes | no  |
| 3     | broken: source read by `fetch` | yes | yes | yes | yes | no  |
| 4     | isolated build                 | yes | yes | yes | yes | no  |

The only failure comes from trial 1, and its cause was not the tool
descriptions: it was the text of the page, which described the mechanism and
diverted the agent into acceptance-testing it. Once fixed, the failure did not
happen again.

**What is established.** The description leads an uncontaminated agent to call
`resume_task` before working, and the format returned is read: constraints and
rejections are quoted by name, with their source and their reason.

**What is not.** Four trials, same model, same instruction: the results are
correlated and are not worth four independent observations. No percentage will
be drawn from them. And it is still not ChatGPT's built-in browser.

## August 26, 2026: non-regression acceptance run, after eighteen passes

Trial build, Brave 151, demo log.

| Check                                      | Result                                                        |
| ------------------------------------------ | ------------------------------------------------------------- |
| Returned state                             | v12, 295 tokens out of 400                                    |
| The four evidence grades                   | present, one of each                                          |
| Provenance shown on the rejections         | yes, `[agent]`                                                |
| Agent write on v11 while the log is at v13 | refused, `STALE STATE` message                                |
| Cross-tab conflict on a human action       | refused, store resynchronized at v13, title re-read from disk |
| Message shown to the human                 | "another tab changed this task in the meantime… so try again" |
| Browser console                            | **empty**                                                     |

The empty console is the point of this run. Up to the seventeenth pass, every
cross-tab conflict left an "Uncaught (in promise)": the `tx.abort()` of the
refusal made `tx.done` reject, and nobody was listening. It was visible to
anyone opening the developer tools during a demo, and it was the tooling (added
in that same pass) that revealed it.

---

## August 26, 2026: native WebMCP validation, through a real MCP client

**This record is the first to go through a real MCP client.** The earlier passes
exercised a fake `ModelContext` in tests; here, `document.modelContext` is the
browser's own, and the tool calls come from `chrome-devtools-mcp` over the
debugging protocol, not from a `tool.execute()` typed into the console.

### Environment

| Item                   | Recorded                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| Browser                | Brave 151.1.93.137, `Chrome/151.0.7922.169`, V8 15.1.206.21       |
| `userAgentData` brands | `Not=A?Brand 99`, `Brave 151`, `Chromium 151`                     |
| MCP client             | `chrome-devtools-mcp` (`--categoryExperimentalWebmcp`), CDP :9222 |
| Flags                  | `--enable-features=WebMCP,WebMCPTesting`                          |
| Page served            | trial build (`npm run build:trial`), no source map, :5174         |
| Context                | isolated tab `watchlog-validation`, blank IndexedDB               |
| Secure context         | yes (`localhost`)                                                 |

### Results

| #   | Check                                               | Result       | Factual observation                                                                                               |
| --- | --------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Exact browser version                               | PASS         | Brave 151.1.93.137 / Chromium 151                                                                                 |
| 2   | `document.modelContext` genuinely present           | PASS         | `typeof document.modelContext === 'object'`, `registerTool` is a function; `navigator.modelContext` too           |
| 3   | Lifecycle mode displayed                            | PASS: static | "Chromium 151: below 153, where unregistering may drop an in-flight reply; tools stay registered"                 |
| 4   | Page with no task: 2 tools                          | PASS         | `list_webmcp_tools` returns exactly `resume_task`, `read_task_detail`                                             |
| 5   | Opening a task: the 5 writes appear                 | PASS         | 7 tools with no reload; the URL becomes `/t/807d06222743`                                                         |
| 6   | `resume_task` returns id, URL, version, rules, next | PASS         | `TASK ID 807d06222743`, `URL http://localhost:5174/t/807d06222743`, `VERSION 15`, 3 constraints, `NEXT` filled in |
| 7   | `complete_task` returns its reply to the agent      | PASS         | `OK: complete_task recorded. VERSION 17` received by the client                                                   |
| 8   | Static mode: the writes stay and refuse             | PASS         | `getTools()` still returns 7 tools after closing; `log_step` → "is already completed … ask the human to reopen"   |
| 9   | Dynamic mode: they disappear after closing          | NOT VERIFIED | Requires Chromium ≥ 153. This browser is on 151, so in static mode by construction. No Chromium ≥ 153 here.       |
| 10  | Reopening: writes usable again                      | PASS         | Human reopening → v18 `active`; `log_step` succeeds at v19                                                        |
| 11  | Exact replay of the same `mutation_id`              | PASS         | Identical reply plus "Replay of an earlier call … Nothing was written twice."; no duplicate, version fixed at 16  |
| 12  | Same `mutation_id`, different arguments             | PASS         | Refused; audit `log_step · agent · v16 · refused` / `mutation_id: mutation-id-collision`, with no version change  |
| 13  | Fresh conversation: "Continue this task"            | NOT VERIFIED | See below.                                                                                                        |
|     | Browser console                                     | PASS         | No error or warning message over the whole session                                                                |

### Why point 13 is not verified

It requires an agent with no context to consult `resume_task` of its own accord.
But the session that produced this record already knew the state of the task: a
call issued from it would prove that the tool answers, not that it is
spontaneously chosen. Measuring that honestly requires a fresh conversation,
which was not done again in this pass.

The records of August 24 and 26 above bear on this point, with their caveats.
They are not replayed here and are not carried over.

### Two details only the real browser shows

1. **The annotations are renamed on projection.** What the page sets as
   `readOnlyHint` / `untrustedContentHint` comes out of `getTools()` as
   `{"readOnly":true,"untrustedContent":true}`. The meaning is preserved, the
   name is not: a test written against the name as set would say nothing about
   what the client receives.

2. **The hardened schemas travel through intact.** `additionalProperties: false`,
   the `minLength`/`maxLength` bounds, the `enum` of evidence kinds, the
   `pattern` of `mutation_id` and the strict nested `evidence` object all appear
   in what the client reads.

### What this record does not say

- Nothing about ChatGPT's built-in browser, which was not tried.
- Nothing about Chromium ≥ 153, so nothing about dynamic mode under real
  conditions.
- Nothing about the spontaneous choice of `resume_task` by a fresh agent.

---

## August 27, 2026, fresh agent, "Continue this task", trial 1: FAILURE

**Protocol.** New Claude Desktop session, opened from `/home`, with no history
of the task. Exact and sole instruction: `Continue this task.`

**Environment observed.** Claude Desktop 2.1.234, final answer by Opus 4.8. The
interface first displayed a "cyber" classification block, then switched to
Opus 4.8. The session held a general memory mentioning other projects, but no
information about the task in progress.

The session trace confirms that the bridge's tools were available to the model,
in particular `mcp__chrome-watch-log__list_pages`,
`mcp__chrome-watch-log__list_webmcp_tools` and
`mcp__chrome-watch-log__execute_webmcp_tool`. This is therefore not a trial
voided by the absence of the tools.

### Observed

| Fact                                 | Value                                                       |
| ------------------------------------ | ----------------------------------------------------------- |
| First relevant move                  | a search of the scratchpad and the recent files with `Bash` |
| `resume_task` called before any work | no                                                          |
| WebMCP bridge tool called            | none                                                        |
| Next action returned                 | no                                                          |
| Rule quoted                          | no                                                          |
| Rejected approach and reason quoted  | no                                                          |
| Final answer                         | asks the human to specify the task                          |

**Conclusion.** FAILURE of spontaneous selection. The bridge and its tools were
present, but the agent favored the file system and did not discover the log.
This trial does not call into question the correct execution of `resume_task`
when it is called; it shows that the single sentence "Continue this task." does
not guarantee that Claude Desktop chooses the bridge. It does not measure tool
selection by an agent whose browser embeds WebMCP directly, without this
intermediate CDP layer.

**Consequence for the demo.** Do not present spontaneous resumption as
deterministic. A new trial must keep the same instruction, check that the bridge
is connected before sending, and record the first tool called. If the choice
remains unstable, the video must show the failure or explicitly ask the agent to
consult the page.

### Continuation of the same session after the instruction was repeated: INVALID FOR R1

The human repeated `Continue this task.` in the same conversation. The agent
then searched more widely in `/home/moon`, spotted `README.md` and this log by
their modification date, then read the README. There it found the product name,
the demo sentence and the explanation of the bridge, all before its first
browser call.

This is neither a fresh conversation nor an agent without a disk. The resumption
therefore cannot be counted as spontaneous.

**Behavioral observations nevertheless valid after this contamination:**

1. `list_pages` found `/t/190237e36fae`;
2. `list_webmcp_tools`, then `resume_task`, returned the Atlas task at v2;
3. a first decision based on v2 was refused after the human intervention that
   produced v3;
4. the agent called `resume_task` again, took in the rejection of "Exponential
   backoff" and its reason, then submitted a new decision based on v3;
5. `add_decision` and `log_step` succeeded, and the final read confirmed v5.

**Limited conclusion.** The real cycle `read → stale write refused → re-read →
adapt → writes accepted` works end to end through the bridge. This continuation
provides no new evidence about the spontaneous choice of `resume_task`.

---

## August 27, 2026, fresh agent with no disk, "Continue this task": PASS

**Protocol.** New Claude Code 2.1.245 / Opus 5 session, launched from
`/tmp/watch-log-agent.57w9jz` with the strict MCP configuration holding only the
`chrome-watch-log` bridge. Among the built-in tools, only `ToolSearch` was
available: no `Bash`, `Read`, `Glob`, `Grep`, `Write` or any other access to the
disk. The local command `/effort max` was run before the trial; it brings no
context about the task. Exact instruction: `Continue this task.`

### Discovery path observed

1. two searches for file tools, with no usable result;
2. a search for `list_pages`, then a call to `list_pages`;
3. reading a snapshot of the page;
4. discovery of `list_webmcp_tools` and `execute_webmcp_tool`;
5. a call to `resume_task` before any output or mutation.

The initial attempts to find file tools are a presentation caveat, but not a
contamination: no file tool was loaded and no file was read. The agent
discovered the browser on its own.

### Resumption contract results

| Code | Check                                                 | Result |
| ---- | ----------------------------------------------------- | ------ |
| R1   | `resume_task` called before any work                  | yes    |
| R2   | next action resumed                                   | yes    |
| R3   | rejected approach named and ruled out with its reason | yes    |
| R4   | active constraint "Do not add Redis" quoted           | yes    |
| R5   | work not done invented                                | no     |

`resume_task` returned task `190237e36fae` at v5: prepare the Atlas release,
write the canary runbook, do not add Redis and do not go back to exponential
backoff because the partner rejects requests that run past two seconds.

### Work and writes observed

- a full read of the decisions, steps, rejections and proposals;
- production of a canary runbook in the conversation;
- two decisions recorded at v6 then v7;
- a first call for the second decision rejected by the client because the JSON
  was malformed, then corrected with no undue state mutation;
- one step recorded at v8, honestly with no evidence attached and therefore
  marked `claimed`;
- a final re-read confirming v8 and a new next action.

**Conclusion.** Point 13 of the native protocol is now PASS in this controlled
environment: a fresh conversation, with no disk and no tool name in the
instruction, consulted `resume_task` before working and resumed the state
correctly. One trial proves possibility, not reliability; it allows no
percentage and does not predict the selection path of a browser with WebMCP
built in.

---

## August 27, 2026, fresh agent with no disk, next controlled trial: FAILURE

**Protocol.** New session `4f397c5d-cea1-4e60-9a8c-eace8637dd88`,
Claude Code 2.1.246 / Opus 5, in the same temporary directory, with the same
strict configuration and `ToolSearch` as the only built-in tool. The trace
records `Continue this task.` as a normal user message, after the local command
`/effort max`.

### Path observed

1. two searches for file tools, with no usable result;
2. discovery and call of `list_pages`;
3. a rendering of the selected page, titled "Watch Log: a shared memory for you
   and your AI" (the product still bore that name on the date of this record),
   at the URL of the task;
4. discovery stopped: no `list_webmcp_tools`, no `resume_task`;
5. a request to the human to specify the work to be done.

The final answer wrongly claims that "Continue this task" came from the
`/effort max` command. The trace nevertheless clearly separates the local
command from the user message sent twenty seconds later.

### Resumption contract results

| Code | Check                                                 | Result |
| ---- | ----------------------------------------------------- | ------ |
| R1   | `resume_task` called before any work                  | no     |
| R2   | next action resumed                                   | no     |
| R3   | rejected approach named and ruled out with its reason | no     |
| R4   | active constraint quoted                              | no     |
| R5   | work not done invented                                | no     |

**Conclusion.** FAILURE of spontaneous selection despite the discovery of the
page. The agent knew that a log page was open and that only the tools of the
browser bridge were available, but it did not look for the WebMCP tools of the
page.

**State of the controlled series: one PASS, one FAILURE.** No percentage is
drawn from two correlated trials. Point 13 must now be presented as MIXED, not
as a capability that is reliable or guaranteed by this bridge.

---

## August 27, 2026, fresh agent with no disk, third controlled trial: PASS

**Protocol.** New session `104b6db0-1379-4345-8608-bb36d5ae8bb4`,
Claude Code 2.1.246 / Opus 5, launched from a new directory
`/tmp/watch-log-agent.mCBX6p`. Same strict configuration, `ToolSearch` as the
only built-in tool, no prior `/effort`. Exact and sole instruction:
`Continue this task.`

### Discovery path observed

1. one search for file tools, with no result;
2. discovery and call of `list_pages`;
3. reading a snapshot of the page;
4. discovery of `list_webmcp_tools` and `execute_webmcp_tool`;
5. a call to `resume_task` at v8 before any work;
6. a read of the full decisions and steps;
7. carrying out the next action, then writes at v9 and v10.

### Resumption contract results

| Code | Check                                                 | Result |
| ---- | ----------------------------------------------------- | ------ |
| R1   | `resume_task` called before any work                  | yes    |
| R2   | next action resumed                                   | yes    |
| R3   | rejected approach named and ruled out with its reason | yes    |
| R4   | active constraint "Do not add Redis" quoted           | yes    |
| R5   | work not done invented                                | no     |

The agent kept the three earlier decisions, turned the gate thresholds into
formulas relative to the baselines and honestly identified the two pieces of
human information still needed: whether or not the change is visible, and the
five telemetry baselines. It invented no measurement.

`add_decision` took the task from v8 to v9, then `log_step` to v10. The step
stayed `claimed`, with no false evidence attached, since the work existed only
as reasoning in the conversation.

**Conclusion of the controlled series: two PASS, one FAILURE.** These three
trials are correlated and justify no percentage. They establish that spontaneous
resumption through the bridge is real and reproducible, but not deterministic.
For the protocol as a whole, point 13 is MIXED; the only complete unknown
remaining is dynamic removal under Chromium ≥ 153.

## 28 August 2026: `search_task`, the eighth tool, checked in the browser

**Machine.** Brave 151.1.93.137 / Chromium 151, Linux, `--enable-features=WebMCP,WebMCPTesting`,
production build served on `http://localhost:5174`, driven by
`chrome-devtools-mcp`.

**Observed.**

- `list_webmcp_tools` returns eight tools. `search_task` is among them, with
  `annotations={"readOnly":true,"untrustedContent":true}` and the expected schema
  (`query` required, `minLength: 2`, `limit` capped at 12).
- `search_task { query: "issuer" }`: `MATCHES 1 shown of 1 found`, the step
  returned with its result, and the section to re-read (`steps`) named.
- `search_task { query: "gemini" }` on a log carrying two credentials
  named `gemini-api-key`: `NO MATCH`. Search does not reach into the
  vault: not the names, and still less the values.
- `read_task_detail { section: "steps" }` after a step logged by hand
  with a test report pasted in: `evidence kind: test_report`, line breaks
  preserved.

**Defects found by this pass, all in the browser and not by the jsdom
tests.**

1. The evidence field on the human form was an `<input type="text">`:
   pasting a command output or a diff flattened its line breaks.
2. The kind of evidence was pinned to `command_output`: a pasted diff was
   announced to the agent as a command output, by `read_task_detail`.
3. Two credentials could carry the same name, which makes `${name}`
   ambiguous, the only thing the agent receives.
4. The success message ("Copied. Paste it to your agent.") never
   cleared: ten minutes later it still claimed an action had just
   taken place.
5. `mount()` reset every draft to the empty string, including the one
   that carried a default value, which made a write invalid.

Each was reproduced by a red test before the fix. The first four were
checked again in the browser after the fix.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine, as in previous passes.

## 28 August 2026: eleven tools, and a channel from the agent to the human

**Machine.** Same configuration: Brave 151.1.93.137 / Chromium 151, production
build on `http://localhost:5174`, driven by `chrome-devtools-mcp`.

**Observed.**

- `list_webmcp_tools` returns eleven tools. The three new ones
  (`ask_human`, `attach_evidence`, `set_next_action`) carry the schemas
  expected and `readOnly: false`.
- Full `ask_human` loop: the tool opens the question (v15 → v16), the
  "Waiting on you" card appears between NEXT and the work, the answer typed
  on the page closes the question (v17), and `resume_task` returns
  `ANSWERED BY THE HUMAN` with the answer. This is the first time an agent
  can leave the human anything other than a proposal.
- `attach_evidence` on a step left `claimed`: evidence attached, line
  breaks preserved, `confidence` moved to `evidence`, never to `human_verified`.
  A second call on the same step is refused, the first piece of evidence intact.
- `set_next_action` changes NEXT without creating a step.
- Vault: a three-line PEM key sealed then revealed byte for
  byte, announced as "Private key". Credentials sealed before kinds
  existed read as "Other" and can be reclassified from the page.

**Defects found by this pass.**

1. `${name}` written in a TypeScript template in `descriptions.ts` was
   interpolated by JavaScript: the global variable `name` is the empty string
   in a browser, and every agent received "the name to write as ,
   and what it is for". Nothing crashed. A test now compares each
   shipped description against that pattern.
2. The `card--waiting` class escaped the CSS guard: extraction skipped
   any `class` attribute containing a `$`, so any class written next to an
   interpolation. The guard now reads the BEM markers wherever they
   are written, and it found the missing class.
3. The kind selector on the correction form was wired to nothing:
   reclassifying a credential silently kept the old kind.
4. A dashboard test passed alone and failed in the full suite: it
   waited a fixed number of loop turns instead of waiting for the write.
   Three consecutive full runs since the fix, all green.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: twelve tools, and the indicator that answers the product's question

**Machine.** Brave 151.1.93.137 / Chromium 151, production build on
`http://localhost:5174`, driven by `chrome-devtools-mcp`.

**Observed.**

- `what_changed` on a task the human edited while the agent was
  working: three writes since v15, split into CHANGES WHAT YOU MAY DO
  (rule added, rule lifted) and ALSO HAPPENED (a step from another agent).
  Response measured at ~90 tokens, against ~400 for `resume_task`.
- The stale-state refusal now names the exact way out:
  `Call what_changed with since_version: 15`. Checked in the browser.
- Indicator: a write that arrived without a prior read is flagged in plain words
  ("1 write arrived without reading this page first"). After a `resume_task`
  followed by a `log_step`, the page says "Every write so far arrived after
  reading this page". Both states observed on the real browser.
- Escape closes whatever is on screen; highlighting marks all four
  occurrences of the same term in a rule, and not the first alone.

**Defects found by this pass.**

1. The indicator counted a refused write as a write that arrived without
   a read, and invited the reader to "check what it recorded", when a refusal
   recorded nothing. Only successful writes are counted.
2. The technical panel is titled "What `resume_task` returns" but rendered
   the state without the URL or the credentials: it showed something other than
   what the agent receives. The test now compares the panel to the tool's
   real output.
3. The runtime version check accepted `0` when every schema
   declares `minimum: 1`. The two are aligned.
4. The four operations added in the previous batch had no verb in
   the history, and no field label in the error messages: the screen
   showed `ask_human` and "the field “questionId”".
5. Search covered neither the questions nor the answers, which are
   often the only trace of a human decision.
6. One more line in WRITE PROTOCOL pushed `resume_task` past the
   400-token budget and cost a credential name on every call. Condensed.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: undoing a decision, and the away digest

**Machine.** Brave 151.1.93.137 / Chromium 151, production build on
`http://localhost:5174`, driven by `chrome-devtools-mcp`.

**Observed.**

- No Undo button on a freshly opened log. After lifting a
  rule, it appears and names itself:
  `Undo: you lifted the rule “Never modify the database schema”`. One click
  restores the rule and the button disappears.
- `what_changed` renders the undo as a sentence, on the agent's side:
  `v17 The human undid their own last decision: lifted the rule “…”`, filed
  under CHANGES WHAT YOU MAY DO: restoring a rule does change what the
  agent is allowed to do.
- Away digest: tab moved to `hidden`, an agent write over WebMCP,
  back to the tab. The "While you were away" card appears at the top:
  "1 write since you last had this page open, at v17". The "Got it" button
  closes it and it does not come back.

**Design decisions taken during this pass.**

1. Undo never reaches back past an agent write, and
   only for as long as the decision is still in force. Without that, opening a
   log from last week would have offered to revoke an old decision in one
   click, and undoing twice would have replayed the same action
   backwards.
2. The page marks itself "seen" only if the tab is actually on screen.
   Without that condition the digest would never have fired: a background
   tab keeps rendering on every agent write.
3. `AuditEntry` now carries `targetId`: without it, an entry could not
   point at what it had touched, and the inverse would have had to re-read the
   rule's text from the detail. Schema moved to v6, normalization in place for
   logs written before.

**Defect found.** `undo` had no verb in the page history or
in `what_changed`: the screen showed "ran undo". Same class of omission as
in the previous batch; the test now covers the operations reserved for
the human.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026, `request_approval`: a tool call that waits on a human

**Machine.** Brave 151.1.93.137 / Chromium 151, production build on
`http://localhost:5174`, driven by `chrome-devtools-mcp`.

This is the product's only blocking call. With no page open in front of
someone, that wait would make no sense: it is exactly what WebMCP
makes possible and what a classic MCP server cannot do.

**Observed, through the real WebMCP surface.**

- **Timed out**: call launched with nobody there to answer. Returns after
  120 s: `NO ANSWER … NO ANSWER IS NOT APPROVAL … treat this exactly as a
refusal`, with `isError: true`. The request stays open on the page.
- **Denial**: a click on "Deny" unblocks the call, which returns `DENIED by the
human`, as an error, with the instruction not to work around it.
- **Approval**: a click on "Allow" unblocks the call, which returns `ALLOWED by
the human` with the action quoted word for word.

The clicks are real clicks on the page's real buttons; only their
triggering is scripted, for lack of two free hands while a call
is blocking.

**Defect found, and it was the worst possible one for this tool.** A second
request carrying exactly the same wording as an already-decided request
received the decision of the first. Observed in the browser: a request
denied earlier made `DENIED` come back instantly for a brand-new request.
With an `allowed` in its place, the product would have authorized an action
nobody had approved. The lookup now takes the most recent request,
never the first; a red test reproduces the exact case.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: disputing a step

**Machine.** Brave 151.1.93.137 / Chromium 151, production build on
`http://localhost:5174`.

The product knew how to approve a piece of evidence, not how to reject it. In a
supervision product, that was an asymmetry: an agent could leave a false
claim that nobody could mark as such.

**Observed.**

- From "Evidence to review", with the evidence in front of you: "Wrong" asks for
  a reason, and the step moves to `disputed`.
- `resume_task` puts the dispute above the constraints:
  `DISPUTED BY THE HUMAN: treat as wrong (1)` with the human's reason.
- The PROGRESS count drops from 3 to 2 "with evidence attached": a disputed
  step no longer counts as proven.
- Undo gives the step back exactly the level it had:
  `evidence`, `human_verified` or `claimed` depending on what was attached to it.

**Visual defect found, and only in the browser.** The dispute
reason was rendered with the `.quote` class, styled as a block but
laid out inline in the row's text: it overlapped the action of
the step. No test could see it: the CSS guard checks that a class
exists, not that it lands properly. Dedicated `.row__dispute` class, and the
probe now compares the rectangles.

**Decision.** The FULL DETAIL sentence in `resume_task` listed the sections;
it had already fallen behind twice, and each added word cost a credential
name inside the 400-token budget. It now points to the schema of
`read_task_detail`, which carries the list and cannot drift. A test compares
the schema's enumeration to `SECTIONS`.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: a log that travels in a link

**Machine.** Brave 151.1.93.137 / Chromium 151, production build on
`http://localhost:5174`.

A judge will ask: "I send the link to a colleague, what do they see?" Until now,
an empty page. The log now travels in the fragment of the address,
which browsers never send to the server.

**Observed.**

- "Copy a link that carries this log" on the demonstration log:
  2,833 characters, `z` marker and gzip signature present: compression
  really does go through `CompressionStream`, with no dependency at all.
- Log deleted from the device, then the link opened: the "A shared log" card
  announces the title, `4 steps · 3 rules · v15`, and says that taking
  the log makes a copy that will not stay in sync.
- Nothing is written before the click. "Take a copy" imports and opens the log;
  the payload disappears from the address so that a reload does not offer it again.

**Defect found.** On the receiving end, the "This task does not exist on this
device" banner showed above the offer: two messages that contradict each
other on screen, one of which alarms for nothing. The banner is suppressed
for as long as a link is being read, and comes back if it is declined. A
test covers both directions.

**Method note.** A first attempt appeared to fail: `location.href`
to the same address changes only the fragment and does not reload the page,
so the old bundle was still running. Recorded here so this
false negative is not taken for a defect.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: the demo catches up with the product

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

**Starting point.** `buildDemoTask()` predated the questions, the
approvals and the disputes. A judge clicking "Try the demo" saw a
product from three batches ago. It was the highest-leverage defect in the repository.

**What was done.** The file is now in two layers:
`buildCoreTask()` (rules, rejections, decisions, work with evidence) and
`buildDemoTask()`, which adds to it a question asked then answered, an
approval request that was denied, and a disputed step with its reason. The cases
that needed a blank page point at the base layer.

**Two decisions taken along the way.**

1. The demonstration ends on an agent write (it re-runs the
   benchmark after the dispute). Without that, "Undo that" showed on
   opening and offered to revoke a decision that nobody had just
   taken.
2. The enriched log pushed `resume_task` to 425 tokens. The degradation
   ladder now knows how to drop settled history (answers
   already given, approvals already decided) before what is still waiting on a
   decision. What is settled can be re-read page by page; what is blocking cannot.

**Observed in the browser.** Demo open: the "Needs you" bar announces
"1 proposal · 1 piece of evidence · 2 steps claimed with no evidence", the
answered question and the disputed step are visible, no "Undo" button on
opening. `?` opens the keyboard help, Escape closes it, `s` opens the
step form.

**Measurement.** The shareable link of the enriched demo: 3,587 characters
compressed. Without `CompressionStream`, 12,255, hence the limit raised to 16,000,
failing which the fallback would have refused an ordinary log and would have served
no purpose.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: not repeating, and not closing in silence

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

**Observed through the real WebMCP surface.**

- `add_constraint` with `"  never modify the DATABASE schema.  "` on a log
  that already carries "Never modify the database schema": refused, nothing
  written. Case, spaces and the final period are ignored.
- `complete_task`: succeeds, then lists what was never settled
  (`1 proposal nobody accepted or declined`, `2 steps still claimed with no
evidence`, `1 step the human says is wrong`), with the instruction to say so in
  the handoff rather than let anyone believe everything had been settled.

**A point of honesty.** The guard compares strings, not meanings:
two different wordings of the same prohibition will both get through. The
refusal message says so in plain words, so that nobody takes this
comparison for understanding.

**Defect found while writing.** The guard had slipped into
`editRejection`: rewording the reason for a rejection while keeping its approach (the
most ordinary case) was refused. Two regression tests had
caught it; the guard is now only on creations.

**Gap closed along the way.** The export carried neither approval
requests nor disputes, while it already carried the questions.
Same family of omission as the previous times, now covered by one test
per section.

**Not verified.** Dynamic removal under Chromium ≥ 153 remains out of reach
on this machine.

## 28 August 2026: storage durability, and carrying rules over

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

**Observed.**

- Technical panel: "Storage is not durable: the browser may clear this when
  space runs short, and nothing here would survive it." That is the real state of this
  machine, read from `navigator.storage.persisted()`.
- A click on "Ask the browser to keep this": Brave refused. The page says
  so ("The browser declined for now") and leaves the button in place. That is
  the expected behavior: Chrome grants durability on usage
  criteria, not on request alone.
- Creating a task: "Carry over the 3 rules from “Refactor the
  authentication module”", checked or not.
- Header: "Last written 14 minutes ago."

**Two method notes, both test errors and not code errors.**

1. A test read the state after `createAndOpenTask` without waiting for the second
   write, the one that carries the rules over. It now waits for the effect, not the
   first promise.
2. Another held a reference to the `details` node from before a render: the DOM
   being replaced on every render, it was inspecting a detached node. Recorded here
   because it is a false negative easily taken for a defect.

**Usability defect fixed.** The first version said nothing when the
browser refused durability: the click had no visible effect, which
reads as a broken button.

**Layering note.** `elapsed.ts` was placed in `src/domain` and not in
`src/ui`: `render.ts` uses it, and the domain must not depend on the view.
Same correction as for `seen.ts` during the audit.

## 28 August 2026: extended undo, tool inspector, filters

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

**Observed.**

- A task renamed, then a click on Undo:
  `Undo: you renamed this task to “A name I will regret”`, and the original title
  comes back. The same now for the next action and for the rewording
  of a rule.
- Tool inspector, collapsed by default under the technical details:
  thirteen tools, each with the exact description and schema that
  the agent receives. A test compares the `<pre>` of the schema to `tool.inputSchema` by
  structural equality, so it cannot drift.
- Search filters on "token": `All (5) · Ruled out (2) · Steps (2) ·
Decisions (1)`. Clicking "Steps" cuts from 5 rows to 2.

**Design decision.** Undo always stops at two things: an
answer to a question, and a logged step. An agent may have read the
answer and built on it; removing it in one click would erase the ground under its
feet. A step is the account of a piece of work, not a supervision decision. A
test states this boundary rather than leaving it implicit.

**What made undo possible.** `AuditEntry` now carries
`previous`, the value it replaced. It is first of all a better log ("renamed:
X → Y" rather than "renamed"), and undo is only a consequence of it.
Schema moved to v9.

**Method note.** A probe read `<h1>` after opening the rename
form, which is precisely what replaces the title: probe error, not code error.
Recorded for the same reason as the previous ones.

## 28 August 2026: the definition of "done", and agents without WebMCP

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

**Two gaps of substance, not of surface.**

1. The log said the next action and never what "done" means.
   A conversation picking up again knew the next step, not the
   destination. `DONE WHEN` now sits next to `NEXT` in what every
   agent reads, and `complete_task` reminds it of that so the closing summary says
   whether it was reached.
2. An agent without WebMCP (the vast majority today) could read nothing
   of this log. "Copy the log as text" copies the exact output of
   `resume_task`, framed by an instruction. A test compares the copied text to the
   output of `renderTaskState` with the same options: it is not a variant
   written for the screen.

**Model choice.** The goal is human-only. An agent can ask for it
through `ask_human`, not write it: the definition of success is precisely the thing
that the human must hold.

**Formatting defect, found in the browser.** `DONE WHEN` had landed
after the disputes block, with no blank line: it read as a part
of that block. Moved up into the header, with `NEXT`.

**Side effect spotted and handled.** Making `optionalText` tolerant of spaces
(so that a field emptied by hand would mean "nothing") made
`set_next_action` able to erase the next action with a string
of spaces, when its schema declares `minLength: 1`. An existing test
caught it. The tool now validates strictly; the human keeps the right to
empty the field.

## 28 August 2026: the overview, and a tool call that shows

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

**Two questions the product could not be asked.**

1. "Which of my tasks is blocked?" meant opening each one. The
   picker now carries, per task, a summary of what is waiting, read
   in the browser: `1 proposal to accept or decline +3 more`. The summary
   names what costs the most to miss and counts the rest; a full
   enumeration in a badge does not read.
2. "Is an agent working right now?" After a real call to
   `search_task`, the header shows: `An agent called search_task just now.`
   The wording reports an observed call, never a presence: nothing in
   WebMCP tells a page that an agent is there, and a test forbids the word
   "connected".

**A test that passed for the wrong reason.** The first draft checked that a
picker row contained "blocked", on a task titled "Blocked
task". It was the title that satisfied the assertion, not the badge. Task
renamed, assertion moved onto the element.

**An intermittent test, tracked down rather than tolerated.** "rules out an approach,
marked human" failed in the full suite about one run in two: it
waited a fixed number of loop turns instead of the write. Four other
places in the same file had the same pattern; three wait on a refusal,
where there is nothing to wait for, and were left as they were. Five full runs
in a row green since.

## 28 August 2026: the history of a single rule

**Machine.** Brave 151.1.93.137 / Chromium 151, production build.

The log already contained everything that had happened to each rule (`targetId`
had been added to make undo possible), but no surface
asked the question "what happened to this one?". Each rule now carries
a "History" button.

**Observed.** A rule lifted from the screen, then its history unfolded:
`28/08/2026, 15:11:39 · You lifted a rule · Never modify the database schema`.
No machine operation name, one history open at a time, no
horizontal overflow.

**Test error, recorded.** The setup called `buildCoreTask()` twice
(once to read the rule's id, once for the task), so
the id matched nothing. The domain correctly refused with
"no constraint with id …"; it was the probe that was wrong.

## 28 August 2026: scale and cost

**Setup.** Chrome, dev server, a task of 40 rules and 30 discarded approaches
written straight into IndexedDB.

The full report is in [scale](echelle.md). What was seen in the browser, and
not only in jsdom:

**Observed.** 12 rule rows out of 40, “28 rules still in force are not shown”,
“Show all 40 rules”; 12 discarded approaches out of 30. After the click:
40 rows, the warning gone, the button now “Show fewer”, focus still on the
button. 360 nodes collapsed, 499 expanded. Real computed styles on the warning
as on the button.

**No screenshot.** The capture panel of this environment returned blank images
while the DOM was answering. Noted rather than replaced by an image that shows
nothing.

**Anomaly not reproduced.** On the first attempt, the page stayed on
“Loading…” after a direct write into IndexedDB; after clearing and rewriting
the same task, it loaded normally. Holding an IndexedDB connection open does
not reproduce the hang. Logged as unexplained.

**Task picker, checked too.** 41 tasks on the machine, 12 rows shown,
“Show all 40 tasks”, 457 nodes; after the click, 40 rows and 681 nodes. That is
the dimension the guard test was missing: it varied the contents of one task,
never the number of tasks.

**Probe errors, logged.** Twice: `.rows li` counted across the whole page when
the card in question was “Rules to follow”, and a DOM reference read back after
a render had replaced it. In both cases it was the probe that was wrong, not
the product.

## 28 August 2026: second scale pass, in the browser

**Setup.** Chrome, dev server, a task of 2000 steps (798 KB in the database)
with evidence attached.

**Database migration observed on the spot.** The database went from version 2
to 3 without being wiped: `db.version === 3`, both indexes present
(`by-id-version`, `by-updatedAt`), and the 2000-step task intact. That is the
point that counts: a failed migration would lose real people's data.

**The index answers correctly.** `getKey(['perf01', 2100])` returns `'perf01'`;
`getKey(['perf01', 9999])` returns nothing. 0.1 ms against 2.3 ms for the full
read-back it replaces.

**A real write from the screen.** A rule added through the form, written and
displayed in 20.5 ms end to end.

**Startup fallback.** `lastTaskId` deleted from the database, reload: the page
found “Shard migration” on its own.

**A keystroke in the search box.** 6.9 ms median, frame included, on that same
task, under the bar set by a 60 Hz frame.

**A decision taken on measurement, against intuition.** Rewriting the page's
58 KB of HTML costs 0.7 ms in Chrome, against 15 ms under jsdom. Rendering by
sections, which looked unavoidable from the jsdom figures, would therefore have
gained less than a millisecond for a rebuild of the entire dashboard. Not
done.

## 28 August 2026: what travels with a link

**Setup.** Chrome, dev server, a task carrying three pieces of evidence, one of
them a command output containing a fake token and an internal hostname.

The shareable link and the export carry the evidence exactly as it was pasted.
The README said so; the screen did not. And the screen is what you read before
you click. Worse, the old message only arrived after the copy, when the
decision had already been made.

**Observed.** On this task, under the share button: “3 pieces of evidence
travel with it, pasted exactly as they were. Command output often holds a token
or an internal hostname: read what it carries before you send this on. Sealed
credentials never travel.” A block of 820 × 50 px, gray `rgb(160, 160, 172)`,
no horizontal overflow. Both evidence fields carry “Kept exactly as pasted, and
it travels with every export and shared link.”, placed under the textarea. The
technical panel carries the export note.

**What was refused.** A warning displayed permanently. It only appears if there
really is evidence attached, and it counts: a warning shown for no reason
teaches people to stop reading it. A test holds that silence.

**A regression narrowly avoided.** The first draft of the copy message lost the
word “copy”, and with it the idea that the recipient receives a copy of their
own, which will diverge. An existing test caught it: it was not checking a
string, it was checking that idea.

## 28 August 2026: Chrome's character budgets

Chrome publishes budgets for WebMCP tools: 30 characters per name, 500 per tool
description, 150 per parameter description, 1.5k per output. These are
recommendations, not hard limits, but beyond them you “run into the agents'
guardrails”.

**Measured before.** Ten descriptions out of thirteen were over, up to 801. One
parameter description (`mutation_id`, 351 characters) was over by more than
double, and it was repeated on all nine write tools. The whole catalogue, what
an agent reads on every enumeration, weighed 20,378 characters.

**After:** 15,576, which is 24% less, and no bound exceeded.

**The editorial rule.** A tool description instructs, the README explains. What
was cut is the justifications (why the rule exists) and the protocol reminders
that already appeared three times: in the schema, in the WRITE PROTOCOL block
of `resume_task`, and in the text of the refusals. No instruction was removed,
and a second block of tests names the ones that had to survive:
“BEFORE doing any work”, “Do NOT guess and carry on”,
“NO ANSWER IS NOT APPROVAL”, “does not prove the work was never attempted”.

**A change tried then backed out.** Dropping `TOKEN_BUDGET` from 400 to 375
to land exactly on Chrome's 1.5k. Measured: seventeen characters saved on an
ordinary output, and one credential name lost on screen on a loaded task. Bad
trade, reverted. The real outputs measure 1501 and 1484 characters: the
recommendation is held to within one character without having aimed at it, and
the 6.7% gap between the product's budget and Chrome's is written into the test
rather than covered up.

**Three existing tests refused the cut, rightly.** They held the replay
contract, the fact that attached evidence is not verified, and the trigger of
`resume_task`. Two of them failed not because the meaning had gone, but because
the sentence straddled a line break in the template: the new tests therefore
compare on text with normalized whitespace, the way an agent reads it.

**Checked in a browser, in the end.** I had written that I could not do it:
this session's panel does not expose `document.modelContext`, and for good
reason, it runs on Chromium 148 (Electron), while WebMCP requires 149 and up.
Brave 151 is installed on the machine, and the README documents the command.
Launched on a throwaway profile with `--enable-features=WebMCP,WebMCPTesting`,
`document.modelContext` is indeed an object and the thirteen tools register as
soon as a task is open (only four before), which is the expected behavior: the
tools follow the state.

Read out as an agent receives it, through `getTools()`:

| Budget                     | Recommended | Measured |
| -------------------------- | ----------- | -------- |
| Tool name                  | 30          | 16       |
| Tool description           | 500         | 499      |
| Parameter description (46) | 150         | 146      |

No overruns. The four read tools do carry `untrustedContentHint`.

**And a mistake in my own guard, found by this check.** I had measured the
output of `resume_task` through `renderTaskState(task)` with no options, that
is 1484 characters. Called for real by `execute_webmcp_tool`, it returns
1528: the tool always passes the task address, which my measurement left out.
The test was therefore reassuring itself about something other than what goes
out. Fixed: it now measures with the address.

The real position is therefore: 1528 characters, 1.9% above Chrome's
recommendation and inside the product's budget (400 tokens, 1600 characters).
Written down rather than patched up by shaving prose to land on a round number:
it is the same trade-off as `TOKEN_BUDGET` at 375, and it is settled the same
way.

## 28 August 2026: verification pass in real WebMCP

**Setup.** Brave 151.1.93.137 / Chromium 151, throwaway profile,
`--enable-features=WebMCP,WebMCPTesting`, dev server. Tool calls go through
`execute_webmcp_tool`, so through the same surface as an agent. Two tabs open
on the same task for the concurrency tests.

### What holds

| Test                                                         | Result                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `document.modelContext` present, `getTools()` sorted by name | yes                                                                            |
| Chrome budgets: name / description / parameter               | 16 · 499 · 146 against 30 · 500 · 150                                          |
| `untrustedContentHint` and `readOnlyHint` on the four reads  | yes                                                                            |
| Lifecycle: 0 tasks → 4 tools, task open → 13                 | yes                                                                            |
| Idempotent replay: same `mutation_id`, same arguments        | original response, “Nothing was written twice”                                 |
| Same `mutation_id`, different arguments                      | refused, explicit reason                                                       |
| Stale version                                                | refused, points to `what_changed`                                              |
| Conflict between tabs                                        | distinct message: “Another page has since written v30”                         |
| Rule written by an agent                                     | arrives as PROPOSAL, not binding, visible on screen                            |
| Blocking authorization                                       | ALLOWED and DENIED make the round trip; the refusal says not to work around it |
| `complete_task`                                              | lists what is still unsettled before closing                                   |
| Write after closing                                          | refused, with what to do next                                                  |
| Reopening                                                    | requires a written reason, and the write tools re-register at once             |
| `credentials` section                                        | returns names, never a value                                                   |
| Console errors across the whole pass                         | none                                                                           |

### Two findings

**1. Two read tools overrun Chrome's output bound.** The guard put in earlier
only measured `resume_task`.

| Output                              | Measured | Against 1.5k |
| ----------------------------------- | -------- | ------------ |
| `resume_task`                       | 1528     | +2%          |
| `what_changed`                      | 613      | holds        |
| `search_task`, ordinary case        | 811      | holds        |
| `search_task`, worst case           | 6,296    | ×4.2         |
| `read_task_detail`, page of 20      | 1,989    | ×1.3         |
| `read_task_detail`, one whole entry | 9,078    | ×6           |

The last one is deliberate: the tool exists to return a whole piece of
evidence, and `MAX_EVIDENCE_LENGTH` is 8000. The other two are bounded only by
a number of entries, never by characters, and one entry can be twenty times
bigger than another.

**2. No refresh between tabs.** The second tab reopened the task and wrote up
to v31; the first still displayed v29 and “Task closed”. It only finds out by
trying to write. The safety guarantee holds (nothing is overwritten silently,
and the refusal even names the other page), but the screen lies until then,
which is exactly what this product holds against others. `visibilitychange`
does not re-read the database; it redraws from memory.

### Probe errors, logged

**Two versions guessed wrong.** An authorization decision increments the
version itself; my next calls therefore carried a stale version. The refusals
were right, the probe was not.

**“Reopening does nothing” came from me.** I had left the `prompt()` hanging
while I fired off other tools; the dialog box came back much later, behind an
unrelated call. Answered straight away, reopening works, and the nine write
tools re-register within the second.

## 28 August 2026: the two findings, fixed and rechecked

**Setup.** Brave 151, two tabs on the same task, calls through
`execute_webmcp_tool`.

### Search now fills up to the budget

Twelve matches of 240 characters came to 6296 characters. The bound is now on
characters and not on the count: 6296 → 1275, and the header says “2 shown of
30 found · 28 more not shown: narrow the query”. Nothing is hidden, search is
there to find.

**A bound I put in then took out.** I had bounded `read_task_detail` the same
way. An existing test refused it, and it was right: `resume_task` is the short
pointer, `read_task_detail` is where you go for volume. Bounding it returned
one or two entries per page as soon as evidence was attached. The split of
roles was deliberate; I had not recognized it before the test told me.

### Two tabs stay in sync

A `BroadcastChannel` announces every write; the tab holding the same task
re-reads it from IndexedDB and redraws itself.

**Observed.** Tab 2 writes a rule. Tab 1 goes from v32 to v33 and displays the
rule, with no click and no reload. No console errors.

**Two defects found while building it, one of which the suite did not see.**

1. **The echo.** A rewrite by line number had turned the receiver's
   `tasksChanged()` into `tasksChangedEverywhere()`: every tab re-announced
   what it received, and two tabs would have sent the message back and forth
   forever. Caught by a test that checked what was emitted.

2. **The deaf tab, seen in the browser only.** The channel was opened lazily,
   on the first announcement. But a tab that only reads never announces
   anything: it stayed deaf, and it was exactly the one that needed waking.
   The suite could not see it, because in every one of its cases the store had
   written before listening. The channel now opens at `init()`, and one test
   starts from a store that does not write a single time.

That is the third time in this project that a green test has hidden a defect
the browser shows in a minute.

## 28 August 2026: security pass in real WebMCP

**Setup.** Brave 151, two tabs, calls through `execute_webmcp_tool`.

### Injection: what an agent writes ends up in the human's DOM

A step written by an agent, carrying
`<img src=x onerror="window.__pwned=1">`, `<script>`, an `<iframe>` and a
`</pre>` meant to break out of the evidence block.

**Observed.** Nothing executed: the four witnesses stay `null`. Zero `<img>`,
zero `<script>`, zero `<iframe>` in `#app`. The text displays as it is,
including once the evidence is expanded. In attribute position (`aria-label`),
the quotes are escaped to `&quot;`; in text position they are not, which is
correct, and not an oversight.

**Probe error.** My first check unescaped the HTML before looking for tags in
it, and so found eight “live tags” that were the escaped entities of my own
payload. The product had nothing to do with it.

### The vault, right down into IndexedDB

A credential sealed from the screen, then the raw record read back.

| Question                         | Answer                                        |
| -------------------------------- | --------------------------------------------- |
| Fields stored                    | `id, taskId, name, purpose, kind, sealed, at` |
| Value in clear in the vault      | no                                            |
| Passphrase in clear in the vault | no                                            |
| Value in clear in the task       | no                                            |
| Contents of `sealed`             | `{ciphertext: "…base64…"}`                    |

`read_task_detail` on `credentials` returns `${gemini-api-key}` and what it is
for, never the value. `search_task` on the value itself: `NO MATCH`.

**Nor does the shareable link.** 7005 characters, decompressed into
19,589 characters of JSON: neither the value, nor even the name. Since the
secrets live outside `TaskState`, `packTask` cannot carry them: the guarantee
is structural, and it can be checked on the byte.

**Passphrase.** Wrong one: “That passphrase does not open this credential.”
Right one: the value, with “Hidden again in under a minute.”

**The worst moment.** With the value displayed on screen, `resume_task` still
returns `CREDENTIALS: names only, values sealed (1)` and the `${name}` alone.

**But the guarantee is the one that is written, no more.** The page says:
“anything you reveal on screen can be read by an agent that drives this
browser”. That is exact, and I have just given the unintended demonstration of
it: I read the revealed value out of the DOM with `evaluate_script`. The
promise is “no TOOL returns a value”, not “no agent can see it”. The product
says so; it had to be checked rather than oversold.

### The decompression bomb, with the real `DecompressionStream`

Fixed at the second audit, never checked in a browser until now.

| Payload         | Measurement                                 |
| --------------- | ------------------------------------------- |
| Plain           | 6,000,302 bytes                             |
| Compressed      | 6,069 bytes, ratio 989:1                    |
| Fragment        | 8,093 characters, under the bound of 16,000 |
| Verdict         | refused in ~100 ms                          |
| Heap afterwards | 4 MB: the 6 MB never existed                |

Message returned: “That link does not carry a readable log.”

### Durability

`navigator.storage.persisted()` is `false` on this profile; 0.54 MB used out of
a 2 GB quota. The page offers “Ask the browser to keep this” when it is not
granted, which is the expected behavior.

## 28 August 2026: export, import, and deleting a task

**Setup.** Brave 151. The download is intercepted by wrapping
`URL.createObjectURL`, the import by building a `File` and a `DataTransfer`, so
through the same paths as the user.

### The export

34,828 bytes of Markdown, a single JSON block. It does carry the injection
payload written earlier (it is the task's content, it has to be there), and
neither the secret's value nor even its name. Consistent with the shareable
link, and for the same structural reason.

### The import, its two branches

| File                       | Result                                     |
| -------------------------- | ------------------------------------------ |
| Identical to what is here  | “1 already here.”, nothing is duplicated   |
| Same id, different version | a COPY, titled “… (imported)”, distinct id |

In both cases the original stays intact, and no secret comes back through the
file.

### Deleting a task takes its sealed credentials with it

It was the most serious defect of the first audit: `deleteSecretsForTask` was
never called, and a sealed credential outlived the task that carried it. Fixed
then, never checked in a browser until now.

Read from IndexedDB, on either side of the deletion:

|        | `tasks`                        | `secrets`                         |
| ------ | ------------------------------ | --------------------------------- |
| Before | `289687a53a75`, `a36c38ba83a6` | `gemini-api-key` → `a36c38ba83a6` |
| After  | `289687a53a75`                 | _(empty)_                         |

The task goes, the secret goes with it, and the other task is untouched.

## 28 August 2026: the page on a narrow screen

**Setup.** Brave 151, emulated viewport 375 × 812, mobile and touch. Never
checked until now, and a judge opens whatever they want.

**What holds.** No horizontal overflow: `scrollWidth` is exactly 375, and none
of the elements in `#app` goes past the width of the viewport. The median
height of a touch target is 41 px.

**What does not hold, and is not fixed.** Four elements fall below a
comfortable target:

| Element                                | Height |
| -------------------------------------- | ------ |
| `<select>` for the credential type     | 19 px  |
| The three links in the “Needs you” bar | 22 px  |

The rest is at 41 px, just under the recommended 44 px, a gap I do not count as
a defect. The four above, I do. Not fixed: layout is an area you do not touch
without a decision, and that one is not mine to take.

## 28 August 2026: on a machine twenty times slower

**Setup.** Brave 151, CPU throttling ×20 through CDP. A task of 3000 steps,
60 rules, 1.27 MB: the earlier measurements had all been taken on a fast
machine, which proves nothing for anyone who does not have one.

**What the page renders.** 409 nodes, 40 KB of HTML: the bounds hold, the size
of the task does not show. A search for “shard” finds 3060 matches and shows
only what fits in the budget.

**The real cost, separated from the compositor's cadence.** The synchronous
work of the keystroke handler is 0 to 2.9 ms: all it does is schedule a render.
Time to paint is ~1005 ms, but that is the cadence of a compositor at ×20, not
the product: any page would take it.

What had to be measured is the main thread. A `PerformanceObserver` on the
`longtask` entries across six keystrokes:

|                                   | ms  |
| --------------------------------- | --- |
| Longest task                      | 147 |
| Median                            | 136 |
| Tasks observed for six keystrokes | 3   |

147 ms at ×20 corresponds to ~7 ms on this machine, which lines up with the
direct measurement of 6.9 ms taken earlier without throttling. On a machine
twenty times slower, a keystroke in the search box therefore costs ~140 ms of
main thread on a task of 1.27 MB: noticeable, not broken.

And three tasks for six keystrokes: the batching by `requestAnimationFrame` is
doing its job: typing fast does not produce one render per character.

**Probe error, logged.** The first measurement was on the wrong task:
`lastTaskId` had been written while the page was already mounted, and the
reload reopened the previous one. The 1009 ms figure I read there was that of a
ten-step task. It measured nothing.

## 28 August 2026: what an adversarial audit found in code written an hour ago

Nine agents launched in parallel: three on the contest, three auditing the code
written today, two on the uncovered surfaces and the production build, one for
synthesis. They found four defects in the `BroadcastChannel` put in an hour
earlier, two of them reachable with two tabs and a ten-step task.

### The worst: a deletion could be undone by the other tab

The deletion announced only “the list has changed”, without naming the task.
The tab next door therefore kept a deleted task on screen, and its next write
brought it back to life. `saveTask` treated “no record” as “not created yet”
and fell back on the `put`.

The task came back with all its steps and all its pasted evidence, but without
its sealed credentials, which really had been erased: the human believed the
data was gone, it came back mutilated, and every `${name}` reference dangled in
the void, and on the operation you perform precisely because you want the data
to disappear.

Commit `26501e8` is titled “Verify … that deleting a task takes its secrets”.
This defect gave it the lie in the two-tab case.

**Two fixes, both necessary.** The deletion names the task
(`{id, gone: true}`), and the receiver switches to `missing`. And `saveTask`
now refuses a write that carries an expected version against an absent record:
such a write is by definition an update, creations go through the path without
a version.

**I had written the opposite assertion.** `test/migration-index.test.ts`
claimed “lets through the very first write of a task that does not exist”.
It was my reasoning that was wrong, not the code that followed it. The test now
asserts the opposite, with the reason.

### Three others, in the same file

- **The re-read did not recheck the binding.** The “is this the open task?”
  guard was evaluated when the message arrived; the work itself was deferred
  into the queue. Between the two, the user can open another task, and the
  re-read flipped the screen, and `boundId`, back to the previous one. Worse
  than the stale screen the channel was meant to remove.
- **No batching.** Measured by the agent on 20,000 steps: fifty announcements
  cost fifty reads and 1702 ms, of which 1668 thrown away. And since the queue
  is shared with the local writes, they delayed this tab's writes by a factor
  of 51. One re-read per task now.
- **The task list was re-read on every write.** `listKey` contained the version
  of the open task, which changes on every write: 61 ms and 15.9 MB read to
  produce 9 KB of cards, across 20 tasks of 2000 steps. The rows of the picker
  do not depend on it.

### Checked with two real tabs

Tab 1 deletes. Tab 2, with no click and no reload:

> This task does not exist on this device. The address points at suppr0000001,
> which is not here. No other task has been opened in its place.

Then an agent tries to write from tab 2: refused. And on disk: `tasks` empty,
`secrets` empty. The task does not come back.

### A surviving mutant, unresolved

Removing the binding recheck inside `resyncFromDisk` turns no test red: the
guard of the queue covers it upstream. The two do have distinct roles (one
avoids the read, the other avoids applying a stale read), and I could not build
a deterministic race for the second. It stays, uncovered, and it is written
here rather than covered up.

### A figure published by the bench was wrong

`bench/detail.bench.ts` was timing `normalizeTask(structuredClone(task))`,
charging the cost of the clone to normalization: 3.94 ms of clone counted
inside 0.24 ms of normalization, at 4000 steps. A factor of sixteen, and it
pointed at the wrong fix: “speed up normalize” instead of “read less often”.
The clone is out of the timer. No published document quoted that figure; only
the bench output was wrong.

## 28 August 2026: the production build, and a README promise that was false

An audit agent built `dist/` and then served it from a BARE static server, not
`vite preview`, which rewrites on its own and was hiding everything. Three
problems, all invisible locally.

### The deep address landed on a 404

The page moves the address to `/t/:id` as soon as a log is opened. On a host
without rewriting, every reload, every bookmark and every shared link landed on
the hosting provider's 404. Verified: `curl http://127.0.0.1:8911/t/abc`
returns 404 on a bare server, 200 under `vite preview`.

`public/_redirects` and `vercel.json` are in place. A bare static server does
not read them (they are hosting-provider conventions), so this point remains to
be verified on the host actually chosen.

### The service worker precached nothing of the application

`SHELL` listed `/`, `/index.html`, the manifest and one icon. The two files the
application is made of carry a hash in their name: they cannot be written by
hand, and nothing was injecting them. Registration happening on `load`, the
first visit does not go through the worker either. After a single visit,
offline rendered a blank page, while the README claimed the opposite,
“verified with the server stopped”.

`scripts/precache.mjs` now writes the real names into `dist/sw.js`, and gives
the cache a name derived from their content, without which `activate` never
deleted anything.

**Verified for real, this time.** Static server stopped, network emulated
offline, a `fetch` of an uncached resource that fails, and the page renders
957 characters of real content. Cache: five entries, including the JS and the
CSS.

### An error page could poison the cache for good

The navigation branch cached the response without checking its status. On a
host without rewriting, the first `/t/:id` returned a 404 that was written over
`/index.html`: the offline fallback then served that 404 for every navigation,
the root included. And the cache name being fixed, no deployment cleaned it.
The `response.ok` check already existed on the resource branch; it was missing
on the navigation one.

### The source map was shipping to production

`npm run build` (what hosting providers detect on their own) produced a 519 kB
source map, heavier than all the rest of the site put together, and one that
makes the entire source readable by an agent driving the browser. It is now on
demand (`SOURCEMAP=1`). `dist/` goes from ~760 kB to 260 kB.

## 29 August 2026: the link protected by a passphrase

A link carries the whole log, and its real leak is not the fragment (which the
browser never transmits), but the place where it gets pasted: a Slack thread,
an email, a conversation that keeps the message.

**What was built.** A second button, “Copy a protected link”, which seals the
link with a passphrase. No new cryptography: it is the vault's `seal`/`unseal`,
AES-GCM 256 and PBKDF2-SHA256 at 600,000 iterations, salt and IV drawn at
random on every seal. Encryption comes after compression, since ciphertext does
not compress.

**What it does not do, and the screen says so.** It does not verify an
identity. A URL fragment is a bearer capability, and authenticating someone
would require a server. What a passphrase proves is knowledge of a secret:
something else, and the most that is available without a server. A mutant that
replaces that sentence with “We check who opens it” turns the suite red.

**Verified in Brave 151, end to end.**

| Step                    | Observed                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Link copied             | 6852 characters, `#log=s` marker, log title absent                                                             |
| Recipient, empty device | “A protected log”: nothing is readable, not even the name                                                      |
| Wrong passphrase        | “That passphrase does not open this link. Ask them to repeat it: the link itself is fine.” and the field stays |
| Right passphrase        | the ordinary offer, title visible, “Take a copy”                                                               |
| After opening           | the fragment has left the address bar                                                                          |

Size: 1.82× the ordinary link (3747 → 6821 characters on the demo log), well
below the 16,000 bound.

**Probe error, recorded.** My first attempt showed the log instead of asking
for the passphrase. I had cleared IndexedDB from the page while it was still
mounted: the store, still in memory, wrote the task back before the navigation.
Going through a fresh page first, the expected behaviour appears. The product
had nothing to do with it.

## 29 August 2026: the product is called Keydler

Full rename: “Watch Log” becomes Keydler, at keydler.com. Earlier commit
messages still say “Watch Log”; it is the same product.

**The rule applied.** The brand becomes “Keydler”; the common noun becomes
“log”. Without that distinction, a blind replacement produced “a readable
Keydler” where the sentence said “a readable watch log”. Three phrasings had to
be redone by hand afterwards: “The Keydler takes…” reads badly for a proper
noun.

**A falsification, corrected.** The rename first rewrote earlier OBSERVATIONS:
an entry from 28 August had a page say it was titled “Keydler: …”, when it
still carried the old name. An audit caught it. The records dated before
29 August quote the strings actually observed again; it is the same rule as for
`chrome-watch-log`, and I had applied it there and not here.

**What was NOT renamed, and why.** Three persisted keys:

| Key               | Where                                        | Consequence of a rename                                    |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `cahier-de-quart` | `DB_NAME`                                    | every log already on people's machines becomes unreachable |
| `watch-log.theme` | `theme.ts` and the bootstrap in `index.html` | the theme preference is lost                               |
| `watch-log:seen:` | `seen.ts`                                    | “while you were away” starts over from zero                |

A guard in the rename script checked that each one survived, and would have
stopped the work if one had disappeared.

The MCP server name `chrome-watch-log` and the `/tmp/watch-log-agent.*`
directories quoted in the measurement protocols are not renamed either: they
are facts of the measurement environment, not the product name, and rewriting
them would falsify the protocol.

## 29 August 2026: the rename audit, and what it caught me on

Four agents in parallel on the rename. Two of their complaints were aimed at my
own work, and both were justified.

### I had falsified the journal

The blind replacement rewrote observations: an entry from 28 August had a page
say it was titled “Keydler: a shared memory…”, when it still carried the old
name that day. Four other French phrasings had become “le Keydler”, “un
Keydler”.

That is exactly the rule I had applied for `chrome-watch-log` and the
`/tmp/watch-log-agent` directories (do not rewrite an observed fact), and had
not applied here. The records dated before 29 August quote the strings actually
observed again, with an aside that dates the name.

### Nine screenshots still showed the old name

Verified by opening `docs/assets/shared-link.png`: “WATCH LOG” in the masthead,
“The Watch Log keeps…” in the tagline, “A SHARED WATCH LOG” as a card title:
three times in a single image, under a caption that now says “A shared log”.
The rename commit had not touched a single image file.

The nine were retaken in Brave, at 1180 × 900 like the originals
(`active-task` full page). The four others (`activity`, `credentials`,
`disputed-step`, `human-intervention`) are card crops with no masthead;
verified by opening `human-intervention.png`, they had nothing to redo.

### Five other fixes

- **The production build stayed silent without an origin trial token.** A
  misspelled variable at the hosting provider produced a healthy-looking site
  where `document.modelContext` never exists, and every check stayed green. It
  now fails, with `ALLOW_NO_ORIGIN_TRIAL=1` as an escape hatch for local
  verification and continuous integration: it is the deployment build that has
  to prove the token arrived.
- **`durability.ts` announced “This log takes …”** for a figure that comes from
  `navigator.storage.estimate()`, so from the WHOLE origin: every log, the
  vault, the service worker cache. The rename had turned a vague sentence into
  a false one. Fixed to “Everything this site stores here takes …”.
- **`package.json`** still carried a description in French with the old name,
  invisible to a search for “watch”, and the repository goes public.
- **Two strings read by an agent** said “log” where “task” carried the meaning:
  “This device holds no log yet” under a `NO ACTIVE TASK` header, and “Another
  log may be open elsewhere, but it is NOT this task”, which compares a log to
  a task in the message whose only role is to stop an agent from resuming the
  wrong work.
- **No social tags and no canonical.** The SPA rewrite returns 200 on any path:
  without a canonical, every made-up URL is an indexable duplicate. Added, with
  `keydler.com` as the origin, the one place in the repository where an
  absolute URL is right rather than a guess about the host.

## 29 August 2026: locking the site down for good

A page that holds a vault of encrypted credentials and exposes thirteen tools
an agent can call deserves better than a policy of principle.

**What the inventory showed.** The product is a rare case: zero outgoing
network requests, no external font, no `data:` image, and not a single `style=`
attribute. A single inline script: the theme bootstrap, which has to run before
the first paint. So the policy can start from `default-src 'none'` and open
nothing but this origin.

```
default-src 'none'; script-src 'self' 'sha256-…'; style-src 'self';
img-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self';
form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none';
upgrade-insecure-requests
```

The inline script goes through its hash, never through `unsafe-inline`, which
would drain the policy of all its value in a single word.
`scripts/headers.mjs` computes the hash on the HTML actually built, substitutes
it into `dist/_headers`, and refuses the build if `vercel.json` does not carry
the same one: a policy that has drifted between two hosting providers reassures
without protecting.

Added to that: HSTS, `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer` (addresses carry task identifiers), the two
`Cross-Origin-*` policies, and a `Permissions-Policy` that refuses the
seventeen capabilities the product does not use.

### The test: does the policy really refuse?

`dist/` served by a server that actually applies `_headers`: an ordinary static
server does not read them, and one would then be verifying a policy the browser
never receives.

| Attack                                   | Result  |
| ---------------------------------------- | ------- |
| Injected inline script (the XSS vector)  | refused |
| Script loaded from a CDN                 | refused |
| Outgoing `fetch` to another origin       | refused |
| Beacon image carrying off the page title | refused |
| Framing the page (clickjacking)          | refused |

Each one with the browser's refusal message as evidence. And the application
itself works entirely under this policy: log created, rule written and
displayed, search, theme, service worker active, and no console error and no
console warning before the deliberate attacks.

### What was not done, and why

**Trusted Types** (`require-trusted-types-for 'script'`) would be the next
notch up. Rendering rests entirely on `innerHTML`; turning it on would break
everything. To be done the day rendering changes, not six days before a
deadline.

**`preload` on HSTS** is not set: registering on the preload list is hard to
undo, and it is not a decision to take in someone else's place.

**Probe error, recorded.** A mutant on `default-src` survived at first. It had
hit the comment that quotes the directive, not the directive. Aimed at the
right line, it dies. And one of my tests was hollow:
`empreintes.length + 1 === 1 + empreintes.length` is true of any number;
rewritten to compare the whole directive.

## 29 August 2026: the first real deployment, and what it revealed

Published on Cloudflare Pages, then verified cold in Brave against
`https://keydler.pages.dev`, not a `dist/` served locally.

### What the hosting provider really does

| Check                                             | Result                                                |
| ------------------------------------------------- | ----------------------------------------------------- |
| The nine security headers are served              | yes, identical to the repository                      |
| The CSP carries the bootstrap script's hash       | `sha256-2MrDQX8a64K4rJscRFFoIUoixVRRP8gk2kHbN6aUmNk=` |
| `/t/abc123` on a URL never visited                | 200, not 404: the SPA fallback works                  |
| Console messages over the whole session           | none                                                  |
| The service worker precaches the real built names | `index-CEbglE2i.js`, `index-DOYQxzjx.css`             |
| Reload with the network cut                       | the page loads, the 13 tools register                 |
| Agent write during the outage                     | accepted                                              |

Cloudflare replaces `index.html`'s `no-cache` with
`public, max-age=0, must-revalidate`. Equivalent effect: revalidation every
time. Left as it is.

### Three defects found in production that no test covered

This is the fourth time in this project that a real browser finds in a minute
what 868 green tests let through.

`set_next_action` was the only agent write that did not pass its version to the
domain. It validated the shape of the `based_on_version` field, then threw its
value away.

1. **A stale write got through.** `based_on_version: 2` accepted while the
   state was at v4. An agent holding an old read overwrote the next action the
   human had just set, with no refusal.
2. **The entry was signed `human`.** The record (the one thing this product
   promises to be honest) credited a human with a write that no human had made.
   An agent re-reading the history concludes “the human changed direction while
   I was working” and falls in line.
3. **One name when it succeeds, another when it fails**: `set_next` applied,
   `set_next_action` refused. So the tool's name only appeared on failures.
   `changes.ts` already listed both, which shows that the duplication had been
   worked around rather than fixed.

Observed on the record of the production log `abf4be0acb7c`, before the fix:

```
- set_next_action · agent · v4 · refused
    next: not-a-string
- set_next        · human · v4 → v5 · applied     ← agent write, signed human
    Point the apex DNS record at the Pages project
```

After the fix and a redeployment, the same sequence on the same log:

```
- set_next_action · agent · v5 · refused
    stale write on v2, current v5
- set_next_action · agent · v5 → v6 · applied
    Point the apex DNS record at the Pages project
```

Both entries live side by side in that record: the old one written by the buggy
version, the new one by the fixed version.

`setNext` now takes the same `(input, actor)` shape as every other mutator.
Seven tests, five mutants killed, including the three original defects. `undo`
still accepts the old operation name, so as not to take the undo away from logs
written before the rename.

### What is not done

**The `keydler.com` domain is not served yet.** It is attached to the Pages
project, but its zone carries a stale A record that proxies to a dead origin
(`error code: 521`). My token has `zone (read)` and reading the DNS records was
refused: I cannot fix it. The domain stays `pending` on the Pages side as long
as that is not done.

**The origin trial token is not in this build**: it is not registered yet. So
the verification above rests on Brave launched with
`--enable-features=WebMCP,WebMCPTesting`, like every previous one, and does not
demonstrate that WebMCP will turn on for a judge on an ordinary browser. That
is what the token will bring, and it remains to be put in place.

### 29 August 2026, later: “the origin is dead” was false

I claimed, here and in a commit message, that the DNS record for `keydler.com`
pointed at a dead origin, and I concluded from it that a workaround through a
Worker route risked nothing since there was “nothing to break”. An adversarial
review contradicted the premise. Measured:

```
https://keydler.com  → 521
http://keydler.com   → 302 → http://www.keydler.com → 200
                       “Site en construction”, x-iplb-* headers (OVH)
```

Cloudflare reaches the origin without trouble in the clear. The 521 is a TLS
fault between Cloudflare and OVH, not a machine that is switched off. Three
consequences:

1. the record points at a live OVH installation. Replacing it is a decision to
   take, not a cleanup to do;
2. “Always Use HTTPS” is disabled on the zone, otherwise the http would never
   have reached the origin;
3. a route pattern with no scheme intercepts the http as well. The origin trial
   token being bound to `https://keydler.com`, a page served in the clear would
   work perfectly and would expose no WebMCP tool. A judge would read “WebMCP
   is not available” on a site that looks healthy.

It is the third point that counts: the workaround turned a loud failure (a 521
that nobody can miss) into a silent failure, during the judging period. The
routes now carry their scheme, but the setup stays prepared and not
recommended, for a reason the review put better than I did: it would make the
OVH record the load-bearing pillar of the site, and would outlive the DNS fix
by hiding it.

**What made the mistake possible.** I probed `https://` and drew a conclusion
about `keydler.com`. A single request in the clear was enough to set me
straight, and I did not make it before writing a conclusion into the
repository.

### A useful refusal, discovered while deploying

The deployment failed before all of that, for an unrelated and instructive
reason: the Workers assets validator refuses the SPA rewrite
`/*  /index.html  200` in `_redirects`, which it takes for an infinite loop,
where Pages accepts it. Two validators, two opinions, on the same file.

The Worker has no use for it: `not_found_handling` does the same job. So
`public/.assetsignore` removes `_redirects` from that one delivery, without
touching the Pages one, which does not send files starting with a dot.
Verified locally: `/t/abc123` returns 200 and carries the CSP.

Nothing was attached to the zone: zero routes, no deployment, `keydler.com`
unchanged.

### A mutation harness that was lying

The first mutations of the redirect Worker reported four survivors. All four
carried apostrophes, which closed the shell string: the commands never ran, and
the harness counted their lack of effect as survival. A harness that does not
check that the mutation applied is measuring its own plumbing. Fixed: it
compares the file before and after, and refuses to conclude if nothing changed.
Nine mutants, nine killed.

### 29 August 2026, end of day: keydler.com serves the site

The DNS record was fixed by hand: `keydler.com` is a proxied CNAME to the Pages
project. The Worker route workaround therefore has no reason to exist, and
nothing was ever attached to the zone. Verified cold in Brave, against the real
domain:

| Check                                       | Result                               |
| ------------------------------------------- | ------------------------------------ |
| `https://keydler.com`                       | 200, the nine headers served         |
| `/t/abc123`, never visited                  | 200, SPA fallback                    |
| `http://keydler.com`                        | 301 to https                         |
| `https://www.keydler.com/t/abc?source=chat` | 301, path and query preserved        |
| `x-iplb-*` headers (OVH)                    | absent, out of the path              |
| Domain on the Pages side                    | `active`, certificate `active`       |
| WebMCP tools, log open                      | 13                                   |
| Reload with the network cut                 | 13 tools, page served from the cache |
| Console messages, whole session             | none                                 |

The URL returned by `resume_task` carries the canonical origin: that is the one
a shared link will carry.

**The day's fix, visible on the domain.** A `set_next_action` on a stale
version is refused (`stale write on v2, current v3`), and the interface
announces it to the human under the name of the tool: “An agent called
`set_next_action` just now, and it was refused”. This morning, the same action
succeeded and appeared under `set_next`, signed `human`.

**What remains, and is blocking.** The origin trial token is not registered.
The whole verification above rests on Brave launched with
`--enable-features=WebMCP,WebMCPTesting`. It does not demonstrate that a judge
on an ordinary browser would see a single tool. That is the only point that
still separates this deployment from a defensible entry.

### 29 August 2026, evening: WebMCP turns on with no flag, and it is demonstrated

The origin trial token is registered, deployed, and verified in a browser that
has no WebMCP flag. This is the first verification in this whole project that
does not depend on `--enable-features=WebMCP,WebMCPTesting`. Every previous one
depended on it, and I said so every time.

The token, read before being used:

```
origin         https://keydler.com:443
feature        WebMCP
third-party    no         subdomains     no
expires        2026-11-17
```

That is 75 days after the freeze of 3 September, 57 after the end of judging.

**The control experiment**, which is what makes the demonstration conclusive.
Brave 152.1.94.117 (Chromium 152), fresh profile, launched with
`--remote-debugging-port=9223 --user-data-dir=… --no-first-run` as its only
flags. No `--enable-features`.

| Origin                      | Tag served     | `document.modelContext` |
| --------------------------- | -------------- | ----------------------- |
| `https://keydler.com`       | the token      | exists, 13 tools        |
| `https://keydler.pages.dev` | the same token | absent                  |

Same build, same browser, same session, same token in the HTML: the only
difference is the origin the token is bound to. Chromium rejects it on the
other one, without saying anything. It is the failure mode I had feared from
the start, observed here rather than assumed, and the proof that it really is
the token, and not a browser setting, that turns the feature on.

A complete agent loop on `keydler.com` in that browser: `resume_task` returns
the state, `log_step` writes, no console message.

**A consequence not to forget:** `keydler.pages.dev` no longer has WebMCP. That
was not the case this morning, where the flag hid the difference. That origin
stays a fallback surface for the interface, not for the tools, as long as no
second token is put on it.

### The token is in version control, by design

`.env.production` is the only `.env` file tracked by git. An origin trial token
is not a secret: it is printed in the HTML of every page served. What tracking
it protects is the ability to rebuild exactly the deployed artefact from the
repository alone, which counts during a freeze where nothing can be caught up
any more.

### 29 August 2026, late: `/workspace` is live

What a “Sign in” button has to reach on a product with no account and no
server. Deployed and verified cold on `https://keydler.com/workspace`, in a
Brave launched with no WebMCP flag at all, fresh profile, deleted afterwards.

| Check                                             | Result                      |
| ------------------------------------------------- | --------------------------- |
| The address survives a direct reload              | `/workspace`, correct title |
| Export and import present outside a log           | both                        |
| Says there is no account and no server            | yes                         |
| Warns that clearing the browser erases everything | yes                         |
| No longer says “not even us”                      | yes                         |
| WebMCP tools (blank origin, no log)               | 4: the reads, as expected   |
| Console messages                                  | none                        |

The direct reload is the case that counts: that is how someone arrives from a
landing page, and it is what `reflectAddress` was overwriting.

**What the measurement settled.** The page advises a file rather than a link,
and that is not a preference: a 60-step log comes to 17,349 sealed characters
against the 16,000 an address holds; the same one as a file comes to 85,657,
with no limit. A link does not carry a log that is really in use, still less a
workspace. Any design that would have rested on “carry your account in a link”
was dead before it was written.

**Two claims withdrawn while writing.** “Nobody else can read it, not even us”
is a promise about trust: we serve the code, so we could change it. What is
demonstrable (and verified in the browser, zero `xhr`, `fetch` or `websocket`
request) is that there is no destination and that the policy blocks other
origins. And nothing claims that the logs are encrypted: only the credentials
vault and the sealed links are, IndexedDB keeps the logs in the clear. Both are
held by tests.

**A branch removed rather than defended.** The refresh of the list carried a
case for “no log open while some exist”. That state is unreachable (`init()`
reopens the last one, `deleteCurrentTask()` reopens another), and a mutant
survived in it. The branch is gone, and the test that claimed to cover it now
says what it really proves.
