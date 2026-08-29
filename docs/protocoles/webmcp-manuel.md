# Manual protocol: WebMCP in a real browser

What the test suite covers, it covers against a fake `ModelContext` written from
the specification IDL. That is useful and it is not enough: a fake cannot fail
in any way other than the way it was written. This document lists what has to be
observed in a real browser, and exactly what has to be seen.

Six checks, half an hour. To be replayed after any change to `src/webmcp/`.

> Two modes, and the mode decides what has to be seen. Removing a tool during
> the life of the document is only safe from Chromium 153 onwards: before that,
> aborting the controller of a tool that is answering can carry its answer away.
> The page sniffs the major version through `navigator.userAgentData` and
> displays its decision in the status panel.
>
> - **Chromium ≥ 153** → dynamic mode: the tools follow the state.
> - **Chromium 149–152, non-Chromium, unreadable version** → static mode: the
>   tools, once placed, stay placed, and refuse cleanly.
>
> Note the displayed mode before starting, and follow the matching column. An
> unexpected mode invalidates checks 3 and 4.

---

## Preparation

```bash
npm run trial
```

The trial build is mandatory: the development server serves the whole source
over HTTP, and a “browser only” agent then reads the entire project through
`fetch`. A trial run on `npm run dev` is void.

```bash
brave --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-webmcp \
  --enable-features=WebMCP,WebMCPTesting \
  http://localhost:5174
```

Pass both flags: the feature is called `WebMCPTesting` in Brave 151, whereas the
`chrome-devtools-mcp` help announces `WebMCP`. The toggle in
`brave://inspect/#remote-debugging` opens no port, and Chromium ≥ 136 refuses
remote debugging on the default profile.

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

Start from an empty log: the Delete this task button until the empty state, or a
fresh profile.

> What `getTools()` proves and does not prove. The panel's “Observed through
> `getTools()`” line reads the browser's table. It is a second source, distinct
> from what the page believes it has placed, and therefore useful. It is not
> proof that the built-in agent sees those tools: the specification reserves
> `getTools()` for agents that live in the page, and the browser's agent goes
> through an internal mechanism. Checks 1 and 2 below must therefore be done
> from the MCP client, not from the console.

---

## 1. Page with no task: two tools

State: no log open.

From the MCP client, list the page's tools.

- [ ] **Exactly two**: `resume_task`, `read_task_detail`.
- [ ] No write tool appears.
- [ ] `resume_task` returns `NO ACTIVE TASK`.

> A write tool exposed here could only refuse. It would lengthen the list the
> agent has to read in order to choose, without ever being able to succeed.

## 2. Active task: seven tools

Open a log (the Try the demo button, or `?mesure=1`).

- [ ] The list goes to seven with no page reload. _(True in both modes: PLACING
      a tool aborts nothing, only removal is risky.)_
- [ ] The five writes are present: `log_step`, `add_constraint`,
      `reject_approach`, `add_decision`, `complete_task`.
- [ ] `resume_task` returns a `TASK ID` and a `URL` at `/t/:id`, and the address
      in the bar matches.

> This is where what a fake cannot guarantee becomes visible: that the MCP
> client really does refresh its list on `toolchange`. If the seven tools only
> appear after a reload, the dynamic lifecycle has no existence outside the
> page.

## 3. `complete_task` returns its answer

Ask the agent to close the task.

- [ ] The agent receives the answer: `OK: complete_task recorded.` with the new
      version. No error, no silence, no timeout.
- [ ] `resume_task` returns `TASK CLOSED`.

Then, according to the mode noted:

- **static**: [ ] the list stays at seven; a `log_step` refuses with
  `task … is already completed` and the invitation to have the human reopen it.
- **dynamic**: [ ] the list drops back to two tools.

> The most important check of the set. This is the sequence where the product
> can lose an answer: the `complete_task` write causes its own removal.
>
> An earlier version of the code held the removal back by one turn of the loop,
> through `setTimeout`, assuming the answer was delivered in the meantime. The
> specification says the opposite: the ordering between the WebMCP task source
> and the timer task source cannot be relied upon. One turn of the loop is not a
> delivery guarantee. Static mode removes the risk at the root: you do not break
> a run with a controller you never abort.
>
> Note the exact browser version on this line: it is the only measurement that
> says anything about the real behaviour of Chrome 149–152.

## 4. Reopening: the writes work again

Click Reopen this task, give a reason.

- [ ] `log_step` succeeds again, with the version returned by `resume_task`.
- **dynamic**: [ ] the list goes back up to seven with no reload.
- **static**: [ ] the list stayed at seven; nothing moves, and that is
  expected.

## 5. Cancellation during a queue wait

Fire two agent writes close together, then interrupt the second one (the
client's “stop” button, or `Esc`) while it is waiting its turn.

- [ ] No mutation is created by the interrupted call: the step counter goes up
      by one only.
- [ ] The version advances by one notch only.
- [ ] The refusal is audited: in the export's “Write log”, a `log_step` line
      marked `refused`, with the reason “cancelled before anything was written”, and
      no change of version.
- [ ] The page's call counter shows the refused call.

> A cancelled call that wrote anyway would produce a write nobody sees go past:
> the agent receives nothing, retries, and the log counts the same work twice.

## 6. Exact replay after a simulated lost answer

Have the agent record a step, noting its `mutation_id`. Then, from the MCP
client, call `log_step` again with exactly the same arguments, `mutation_id`
included.

- [ ] The answer is identical to the first one, followed by the note
      “Replay of an earlier call with this mutation_id. Nothing was written twice.”
- [ ] The number of steps has not changed.
- [ ] The version has not changed.

Then call `log_step` again with the same `mutation_id` and a different `action`.

- [ ] The call is refused, with a message containing `different arguments`.
- [ ] Nothing is written, and above all no `OK` is returned: an agent that
      believes its work recorded does not record it again.
- [ ] The refusal is audited: a `log_step` line … `refused`, reason
      `mutation_id: mutation-id-collision`.

---

## Record sheet

| #   | Check                                      | Browser / version | Mode noted | Result | Notes |
| --- | ------------------------------------------ | ----------------- | ---------- | ------ | ----- |
| 0   | Mode displayed in the status panel         |                   |            |        |       |
| 1   | 2 tools with no task                       |                   |            |        |       |
| 2   | 7 tools on an active task, no reload       |                   |            |        |       |
| 3   | `complete_task` does return its answer     |                   |            |        |       |
| 4   | Reopening: writes working again            |                   |            |        |       |
| 5   | Cancellation: no mutation, refusal audited |                   |            |        |       |
| 6   | Exact replay / argument collision          |                   |            |        |       |

Report the readings in `docs/verification.md`, with the exact browser version. A
point that was not observed is recorded as “not verified”, never as “assumed
good”.
