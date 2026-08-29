# Development plan: watch log

> Deadline: September 3, 2026, 13:00 PDT (22:00 Paris).
> Target for filing: the evening of September 2. The 3rd is only a safety net.
> Repository reset to zero on August 26.

---

## 1. The split

This is the only point to lock down before writing a line. As long as it stays
vague, every task risks falling between the two.

| Track           | Who   | Content                                                                                          |
| --------------- | ----- | ------------------------------------------------------------------------------------------------ |
| Design          | Kymra | Style guide, colors, typography, shapes, the look of every screen                                |
| Network         | Kymra | Hosting, public URL, public repository, submission description, filing the entry                 |
| Everything else | Moon  | Architecture, domain, WebMCP, persistence, interface code, tests, CI, documentation, measurement |

Put differently: the _behavior_ of the interface is in Moon's track, its
_appearance_ in Kymra's. A screen exists, displays and reacts because Moon coded
it; it is beautiful because Kymra dressed it.

The video is a presentation video, produced at the end. It explains what was
built and the use made of WebMCP; it therefore does not depend on catching a
write refusal live. Decided on August 26.

---

## 2. The contract between the two tracks

So that Kymra can work without ever touching the logic, and Moon without ever
waiting on the style guide:

- **No visual value hard-coded in a component.** Color, spacing, typography,
  radius, shadow: everything goes through CSS variables declared in a single
  token file.
- **Moon delivers that file with neutral values**, readable and accessible, but
  with no aesthetic pretension. It is a starting point, not a design
  proposal.
- **Kymra rewrites that file**, and nothing else. The rest of the code does not
  move, the tests keep passing.
- **The markup is semantic** (headings, lists, forms, regions) so that
  restyling never calls for restructuring.

This contract is what lets the two tracks move forward in parallel instead of
blocking each other.

---

## 3. Proposed technical scope

> To confirm before D2. This scope is the one that makes the demonstration
> possible; cutting it further removes a pillar.

- **Six WebMCP tools**: `resume_task`, `log_step`, `add_constraint`,
  `reject_approach`, `add_decision`, `complete_task`.
- **Versioned state**: every applied mutation increments the version.
- **Stale writes refused**: every agent write carries the version it believes it
  is working on; a divergence is refused, never merged.
- **The human write is authoritative**: no version, never refused. It is what
  makes the agent's write stale. All of the supervision rests on that asymmetry.
- **Local persistence** in IndexedDB. No account, no server: this removes
  authentication and makes the demonstration reproducible immediately.
- **Degrees of proof** distinguishing proven work from asserted work.

### Technical correction to the initial plan

`navigator.modelContext` has been deprecated since Chrome 150: the specification
moved the getter to `Document` in the May 27, 2026 draft. The code must target
`document.modelContext` with a fallback to the old form, and that instability
must stay sealed inside a single adapter.

### The four things that never get cut

The permanent pointer and its resumption · versioning with stale writes refused
· a human adding a constraint live · the visual distinction between proven and
asserted work.

Everything else is scenery. The last two call for an interface: their _behavior_
is in Moon's track, their _appearance_ in Kymra's.

---

## 4. Calendar

Every day carries a verifiable exit criterion. A day whose criterion is not met
is caught up that same evening, not the next day.

### D1: August 26 · LOCK

Prove resumption, and nothing else. No interface, no styling, no final data
model.

- Bare Vite + TypeScript project.
- A single `resume_task` tool returning a fixed string, registered at load time
  in a singleton module, and never from a `useEffect`.
- Detection of a missing `document.modelContext` with a help message.

The criterion splits into two distinct tests, which must not be confused.

**Test A: registration.** Chrome with `chrome://flags/#enable-webmcp-testing`,
then DevTools → Application tab → WebMCP section. Registered tools
appear there and can be invoked by hand. No agent needed, no deployment:
`localhost` is a secure context.

**Test B: discovery by an agent.** An MCP bridge
(`@mcp-b/chrome-devtools-mcp`) exposes the page's tools to an MCP client:
Claude Code or Codex CLI, both runnable under Linux. Fresh conversation, tab
open, the instruction “continue”.

> **Exit criterion.** Test A passes, and in a fresh conversation with no
> history, the agent goes looking for the page's tools and calls `resume_task`.
> If Test A fails, the code is at fault. If only Test B fails, it is the
> description: rework it until it works.

**What Test B is not.** Through the bridge, the agent sees two generic tools
(`list_webmcp_tools` and `call_webmcp_tool`) and not the page's tools directly.
That is a different discovery path from the one in ChatGPT's built-in browser.
Real, but different: not to be presented as anything other than what it is.

**Workstation constraint.** ChatGPT desktop does not exist under Linux. This is
not blocking: the contest rules ask for a URL reachable “via ChatGPT's built-in
browser or Google Chrome with WebMCP enabled”, and impose no AI client for the
demonstration.

### D2: August 27 · The core

Domain model, IndexedDB store, six tools. Verification through the WebMCP panel
in the developer tools, not through an interface.

- Types frozen, version increment on every mutation without exception.
- Write refused on a divergent version, with an explicit message pointing back
  to `resume_task`.
- Task identifier in the URL, state reloaded on mount.
- Invariant tests and CI in place.

> **Exit criterion.** The six tools invoked by hand produce a coherent state
> that survives a reload. A deliberately stale call is refused.

### D3: August 28 · The resumption contract

The most underestimated day: it is no longer about code but about wording.

- Readout format calibrated under 400 tokens, constraints and rejections never
  truncated.
- Descriptions of the six tools iterated against a real agent.
- End-to-end scenario: start, cut, resume, verify.

> **Exit criterion.** On a real task, conversation closed then reopened: the
> agent spontaneously cites a constraint and refuses a rejected approach. This
> is the video's scenario, reproducible before we film.

### D4: August 29 · Interface, behavior

Make visible what already exists. Semantic markup, wiring to the store, empty
states, loading and error. Neutral visual values, all in variables.

- Status banner, timeline, panels, proof counters.
- Immediate update on every tool call, without a reload.
- **Delivery of the token file to Kymra**, with the list of what she controls.

> **Exit criterion.** An observer understands the state of the task without
> explanation. And Kymra can start.

### D5: August 30 · Human supervision

The moment the product stops displaying and starts supervising.

- Adding a constraint by hand, marked `human`, which increments the version.
- Approving a piece of evidence in one click.
- Disabling a constraint, rejecting an approach manually.
- A visible signal when an agent write is refused for stale state.

> **Exit criterion.** A filmable sequence: type a constraint while the agent is
> thinking, see the next write refused, then the agent call the pointer again
> and respect the new rule.

### D6: August 31 · The measurement

Deliberately tightened scope: eight tasks, a single metric.

- Every task has an explicit constraint and a condemned approach.
- Control condition without the log, condition with the log, same tasks, same
  opening instruction.
- A single, binary metric: is the rejected approach proposed again?
- Protocol and logs committed to the repository.

> **Exit criterion.** One sentence with a number in it, true and reproducible.
> If the gap is small, say so anyway: an honest and modest result is worth more
> than an unverifiable number. Four tasks at a minimum, never zero.

### D7: September 1 · Integration and dossier

- Taking in Kymra's tokens, checking that nothing broke.
- README: architecture, local startup, behavior without WebMCP, demonstration
  scenario, measurement protocol.
- Keyboard accessibility, contrast, narrow layout.

> **Exit criterion.** The repository is readable by someone who has never seen
> the project, and `npm run check` passes.

### D8: September 2 · BUFFER

A deliberately underloaded day: it absorbs the delays of the seven before it.

- Full run-through on a clean machine, in private browsing.
- Check of the page without WebMCP active.
- Empty states polished.

> **Exit criterion.** Everything that falls under the technical track is ready
> and verified. Filing the entry falls to Kymra.

---

## 5. What is needed from Kymra, and when

These dates are deadlines, not wishes. Each one blocks a whole day if it slips.

| What                          | Deadline      | Blocks                            |
| ----------------------------- | ------------- | --------------------------------- |
| Deployed HTTPS URL            | August 31     | Eligibility, and the judges' test |
| Repository switched to public | September 1   | Eligibility of the submission     |
| Design tokens                 | **August 31** | The D7 integration                |
| Video                         | September 1   | Eligibility                       |
| Submission description        | September 2   | Eligibility                       |

The repository is private as of today, while the contest requires a public
repository. It is the simplest point to settle and the costliest to forget.

---

## 6. The cuts, in order

Decided coldly now so as not to improvise them on September 1. We cut first
what does not show on screen, and never the central mechanism.

1. **The log export**: useful in real life, invisible in a demonstration.
2. **The `machine_verified` degree**: three degrees instead of four.
3. **Decisions and their justification**: the triptych constraints / rejections
   / steps is enough; `add_decision` can disappear.
4. **The measurement brought back to four tasks**: never removed entirely.
5. **Multi-task support**: a single active log, fixed identifier.

---

## 7. What can make the effort fail

### The agent does not call the pointer on its own

The main risk, and it shows up as soon as tonight. The cause is almost always
the description: too descriptive, not prescriptive enough. Make the wording bear
on the circumstances of the call rather than on the function.

### The split leaves a hole

Two of the four pillars call for an interface. If “design” is understood as “the
whole interface”, nobody codes their behavior and the project loses half of its
demonstration. The contract in section 2 exists to avoid exactly that.

### The measurement shows no gap

Possible if the tasks are too short for the agent to drift. Lengthen the tasks
and harden the constraints, never dress up the result. An inflated number
discovered by a judge disqualifies.

### Deployment arrives too late

Three deliverables out of four depend on a live URL. If it only exists on
September 1, there is no margin left to discover that it does not work.
Development, for its part, does not wait on it: everything is tested on
`localhost`.

### Registration and discovery get confused

The DevTools panel proves that the tools exist, not that an agent calls them of
its own accord. Validating D1 on Test A alone would give false assurance and
would surface the real problem on September 1.

---

## 8. Check before filing

- [ ] The URL opens over HTTPS and works in private browsing, with no account
- [ ] A fresh conversation discovers the tools and resumes the task
- [ ] The repository is public, carries an MIT license and a usable README
- [ ] The video runs under three minutes, is public, with audio
- [ ] The description explains what use is made of WebMCP, and why it is necessary
- [ ] The measurement protocol and its logs are in the repository, reproducible
- [ ] No unverifiable number anywhere, not the video, not the description, not the README
