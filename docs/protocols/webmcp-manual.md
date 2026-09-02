# Manual protocol : WebMCP in a real browser

What the test suite covers, it covers against a fake `ModelContext` written from
the specification IDL. That is useful and it is not enough : a fake cannot fail
in any way other than the way it was written. This document lists what has to be
observed in a real browser, and exactly what has to be seen.

Seven checks, about forty minutes. To be replayed after any change to `src/webmcp/`.

> Two modes, and the mode decides what has to be seen. Removing a tool during
> the life of the document is only safe from Chromium 153 onwards : before that,
> aborting the controller of a tool that is answering can carry its answer away.
> The page sniffs the major version through `navigator.userAgentData` and
> displays its decision in the status panel.
>
> - **Chromium ≥ 153** → dynamic mode : the tools follow the state.
> - **Chromium 149–152, non-Chromium, unreadable version** → static mode : the
>   tools, once placed, stay placed, and refuse cleanly.
>
> Note the displayed mode before starting, and follow the matching column. An
> unexpected mode invalidates checks 3 and 4.

---

## Preparation

Run this against **https://keydler.com**, not a local server. The deployed
origin carries a valid origin trial token, so WebMCP activates in an ordinary
browser with no flag, which is also what a judge will do. It serves the built
bundle, so there is no source to read and no source map : the reason the trial
build was mandatory locally does not apply.

```bash
open -na "Microsoft Edge" --args --remote-debugging-port=9222 \
  --user-data-dir=/tmp/edge-webmcp \
  https://keydler.com
```

Edge was observed serving the origin trial and reporting `WebMCP active` with no
flag at all. Brave 151 needs `--enable-features=WebMCP,WebMCPTesting`, and both
names are required there : the feature is `WebMCPTesting` in Brave, while the
`chrome-devtools-mcp` help announces `WebMCP`. Chromium ≥ 136 refuses remote
debugging on the default profile, so the separate `--user-data-dir` is not
optional.

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

Start from an empty log : a fresh profile, or Delete this task until the first
screen shows the creation form.

**Note the mode and the tool count before starting.** The status panel prints
both. Static mode is the contest target.

> What `getTools()` proves and does not prove. The panel's “Observed through
> `getTools()`” line reads the browser's table. It is a second source, distinct
> from what the page believes it has placed, and therefore useful. It is not
> proof that the built-in agent sees those tools : the specification reserves
> `getTools()` for agents that live in the page, and the browser's agent goes
> through an internal mechanism. Checks 1 and 2 below must therefore be done
> from the MCP client, not from the console.

---

## 1. Page with no task : five tools

State : no log open.

From the MCP client, list the page's tools.

- [ ] **Exactly five**: `resume_task`, `what_changed`, `read_task_detail`,
      `search_task`, `create_task`.
- [ ] No write tool appears beyond `create_task`.
- [ ] `resume_task` returns `NO ACTIVE TASK`, and its text names `create_task`.
- [ ] The badge reads `WebMCP active · 5 tools`.

> Every other write could only refuse here, and would lengthen the list the
> agent has to read in order to choose without ever being able to succeed.
> `create_task` is the exception because it is what ends this state.

## 2. The agent opens the log itself

**The check this protocol exists for today.** `create_task` was added after the
last browser run, and nothing yet establishes that an agent reaches for it
unprompted. The demonstration script's 0:35 beat depends on the answer.

From a fresh conversation, with the page open, say only what the work is. Do not
name the tool :

> We need rate limiting on our HTTP API. Pick a mechanism. We cannot add any new
> infrastructure, and Redis is out, operations refused it.

- [ ] The agent calls `resume_task` first.
- [ ] It then calls `create_task` **without being told to**, naming the task and
      its next action from what it was given.
- [ ] The address becomes `/t/:id` with no reload.
- [ ] It files the rule and the ruled-out approach through `add_constraint` and
      `reject_approach`, carrying the reason.
- [ ] Those land as proposals : the page shows `NEEDS YOU`, and the rules are not
      yet binding.

> If the agent does not call `create_task` on its own, record that plainly and
> film the fallback. A tool an agent will not reach for is a tool that does not
> exist in practice, and saying so is worth more than a retake.

## 3. Active task : thirteen tools

- [ ] The list goes to thirteen with no page reload. _(True in both modes :
      PLACING a tool aborts nothing, only removal is risky.)_
- [ ] The nine writes are present : `log_step`, `attach_evidence`,
      `set_next_action`, `add_constraint`, `reject_approach`, `add_decision`,
      `ask_human`, `request_approval`, `complete_task`.
- [ ] **static**: `create_task` is still listed, and refuses with the name of the
      open task. The badge reads `14 tools`.
- [ ] **dynamic**: `create_task` is gone. The badge reads `13 tools`.
- [ ] `resume_task` returns a `TASK ID` and a `URL` at `/t/:id`, and the address
      in the bar matches.

> This is where what a fake cannot guarantee becomes visible : that the MCP
> client really does refresh its list on `toolchange`. If the seven tools only
> appear after a reload, the dynamic lifecycle has no existence outside the
> page.

## 4. `complete_task` returns its answer

Ask the agent to close the task.

- [ ] The agent receives the answer : `OK: complete_task recorded.` with the new
      version. No error, no silence, no timeout.
- [ ] `resume_task` returns `TASK CLOSED`.

Then, according to the mode noted :

- **static**: [ ] the list stays where it was; a `log_step` refuses with
  `task … is already completed` and the invitation to have the human reopen it.
- **dynamic**: [ ] the list drops back to the five read-and-create tools.

> The most important check of the set. This is the sequence where the product
> can lose an answer : the `complete_task` write causes its own removal.
>
> An earlier version of the code held the removal back by one turn of the loop,
> through `setTimeout`, assuming the answer was delivered in the meantime. The
> specification says the opposite : the ordering between the WebMCP task source
> and the timer task source cannot be relied upon. One turn of the loop is not a
> delivery guarantee. Static mode removes the risk at the root : you do not break
> a run with a controller you never abort.
>
> Note the exact browser version on this line : it is the only measurement that
> says anything about the real behaviour of Chrome 149–152.

## 5. Reopening : the writes work again

Click Reopen this task, give a reason.

- [ ] `log_step` succeeds again, with the version returned by `resume_task`.
- **dynamic**: [ ] the list goes back up to thirteen with no reload.
- **static**: [ ] the list never moved; nothing changes, and that is
  expected.

## 6. Cancellation during a queue wait

Fire two agent writes close together, then interrupt the second one (the
client's “stop” button, or `Esc`) while it is waiting its turn.

- [ ] No mutation is created by the interrupted call : the step counter goes up
      by one only.
- [ ] The version advances by one notch only.
- [ ] The refusal is audited : in the export's “Write log”, a `log_step` line
      marked `refused`, with the reason “cancelled before anything was written”, and
      no change of version.
- [ ] The page's call counter shows the refused call.

> A cancelled call that wrote anyway would produce a write nobody sees go past :
> the agent receives nothing, retries, and the log counts the same work twice.

## 7. Exact replay after a simulated lost answer

Have the agent record a step, noting its `mutation_id`. Then, from the MCP
client, call `log_step` again with exactly the same arguments, `mutation_id`
included.

- [ ] The answer is identical to the first one, followed by the note
      “Replay of an earlier call with this mutation_id. Nothing was written twice.”
- [ ] The number of steps has not changed.
- [ ] The version has not changed.

Then call `log_step` again with the same `mutation_id` and a different `action`.

- [ ] The call is refused, with a message containing `different arguments`.
- [ ] Nothing is written, and above all no `OK` is returned : an agent that
      believes its work recorded does not record it again.
- [ ] The refusal is audited : a `log_step` line … `refused`, reason
      `mutation_id: mutation-id-collision`.

---

## Record sheet

| #   | Check                                       | Browser / version | Mode noted | Result | Notes |
| --- | ------------------------------------------- | ----------------- | ---------- | ------ | ----- |
| 0   | Mode displayed in the status panel          |                   |            |        |       |
| 1   | 5 tools with no task                        |                   |            |        |       |
| 2   | Agent calls `create_task` unprompted        |                   |            |        |       |
| 3   | 13 tools on an active task, no reload       |                   |            |        |       |
| 4   | `complete_task` does return its answer      |                   |            |        |       |
| 5   | Reopening : writes working again            |                   |            |        |       |
| 6   | Cancellation : no mutation, refusal audited |                   |            |        |       |
| 7   | Exact replay / argument collision           |                   |            |        |       |

Report the readings in `docs/verification.md`, with the exact browser version. A
point that was not observed is recorded as “not verified”, never as “assumed
good”.
