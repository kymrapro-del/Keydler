# Audit of 28 August 2026

A deep defect hunt, run over the whole repository. This document says what was
looked for, what was found, what was fixed, and what remains known and
untreated. The points left open appear here on the same footing as the fixes : an
audit that lists only its successes is not usable.

**State at the time of the audit :** 663 tests, 95.8% coverage, full check green.
At the end : 667 tests, 4 new ones covering the defects found.

---

## Method

Four passes, in this order.

1. **Static review by area**: domain, store, persistence, WebMCP tools, UI,
   export, vault.
2. **Edge-case probes**: empty log, texts at maximum lengths, hostile
   characters, pagination bounds, absurd versions.
3. **Real-browser probes**: Brave 151 / Chromium 151, production build, driven
   with `chrome-devtools-mcp`, including multiple tabs.
4. **Mutation tests**: the code is deliberately broken on thirteen guarantees,
   and the suite is checked for going red. A test that stays green on wrong code
   proves nothing.

---

## Defects found and fixed

### 1. Sealed credentials outlived the deletion of the task

**Severity : high.** `deleteSecretsForTask` existed in the vault and was called
nowhere. Deleting a task removed the task from the `tasks` store and left its
sealed secrets in `secrets`, out of reach of the screen (no task to list them
under), but very much present on disk.

The human who deletes a task believes everything has been deleted. In a product
whose vault is a headline argument, that is a confidentiality defect, not sloppy
housekeeping.

**Fix.** `deleteCurrentTask` deletes the log's sealed values, and only its own.
Two tests : one checks that nothing is left in `secrets` for the deleted id, the
other that another log is untouched.

### 2. Read markers accumulated without end

**Severity : low.** Every log opened writes a `watch-log:seen:<id>` key in
`localStorage`. It was never cleared, not on task deletion, not ever. Observed
in the browser : three keys remained for logs that no longer existed.

**Fix.** `deleteCurrentTask` forgets the marker of the deleted log, and only its
own.

### 3. A dependency running against the layers

**Severity : low (debt).** Fix no. 2 made `src/store/taskStore` import
`src/ui/seen`: the store depended on the UI. `seen.ts` belongs to browser
storage, not to the view. Moved to `src/persistence/seen.ts`.

### 4. A file input with no accessible name

**Severity : very low.** `#import-file` carries the `hidden` attribute, so it
does not appear in the accessibility tree and no screen reader meets it : the
probe's report was a false positive. An `aria-label` was added all the same : it
costs nothing and closes the question for the next audit.

---

## What was checked and holds

### Concurrency and idempotence

| Trial                                                     | Result                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| Ten agent writes fired in parallel on the same version    | 1 applied, 9 refused, version +1, a single step written |
| Same `mutation_id` called three times in parallel         | 1 write, 2 replays, no error                            |
| `mutation_id` reused with different arguments             | refused, nothing written                                |
| Human write interleaved between an agent's read and write | `STALE STATE`, nothing written                          |
| Signal already broken at call time                        | nothing written, refusal recorded in the audit log      |
| Cancellation during a 60 s approval wait                  | returned in under a second, no timer left hanging       |

### Multiple tabs, in a real browser

Two pages open on the same log. A rule added in tab 2 appears automatically in
tab 1 (v3, rule visible). An agent write based on v2 from tab 1 is refused with
the right message, "Another page has since written v3", and the refusal is
displayed in human language in the Activity card.

### Schema migration

A log written at `schemaVersion: 4` (before questions, approvals and disputes
existed) reads without an exception, receives the missing arrays as empty ones,
and goes through every surface : rendering, export, `needsYou`, `undoable`,
search, and each of the nine sections of `read_task_detail`.

### Hostile characters and degenerate cases

- `<img src=x onerror=alert(1)>` entered as a task title : displayed literally,
  no element injected, console empty, nothing in the tab title.
- Search with `(b)`, `[c]`, `*e*`, `+f+`, `?g?`, `|h|`, `\`: no exception,
  correct results, because search does not build a regular expression from the
  query.
- Japanese, emoji outside the basic plane, a writing-direction mark :
  round-tripped through a shared link byte for byte.
- A completely empty log : goes through every surface without falling over.
- Texts at maximum lengths everywhere : `resume_task` stays under 400 tokens.
- `offset` beyond the end of a section : says "past the end" rather than
  returning an empty page that would look like an empty section.

### Human typing while an agent writes

Step form open, text typed, an agent write through WebMCP in the meantime, then
submission : the typing survives the render, the step is recorded, the form
closes.

### Mutation tests : thirteen guarantees, thirteen killed

Each line below was broken in the source, the suite was run, and the code was
restored. No mutant survived.

| Guarantee broken                                      | Suite |
| ----------------------------------------------------- | ----- |
| Stale-state refusal disabled                          | red   |
| Agent evidence marked "verified"                      | red   |
| Every step marked "verified"                          | red   |
| Duplicate credential name allowed                     | red   |
| Approval : first request returned instead of the last | red   |
| Credential kind always "other"                        | red   |
| Link with no size bound                               | red   |
| Undo crossing an agent's work                         | red   |
| `needsYou` on a closed task                           | red   |
| `what_changed` hiding its trimming                    | red   |
| Silence presented as agreement                        | red   |
| Witness not counting a blind write                    | red   |
| Token budget ignored                                  | red   |

### Hygiene

- No `TODO`, `FIXME` or `HACK` in the sources.
- No `any`, explicit or by assertion.
- A single `console.warn`, on a storage upgrade blocked by another tab.
  Deliberate.
- `npm audit`: 0 vulnerabilities. No production dependency.
- Bundle : 160 KB of JavaScript, 12 KB of CSS.
- Accessibility : every visible field labelled, no heading level skipped, no
  button without an accessible name, no horizontal overflow.

---

## Known, not fixed

These points are choices or limits accepted as such. They are not oversights.

### `needsYou` stays active on an archived log

Archiving is not closing. An archived log keeps its `active` status, so the
"Needs you" bar goes on announcing there what has not been settled. That is
defensible (opening an archived log and seeing what was left is useful), but it
is a choice, not an obvious one. To be revisited if archiving becomes common
usage.

### Three silent `catch {}`

In `register.ts`, `taskStore.ts` and `bench.ts`. Each one wraps an operation
whose failure must not interrupt the thread : a re-read after a conflict, an
inspection `getTools()`, a render cleanup. They are deliberate, and the lint
allows them explicitly. They remain places where a real failure would go
unnoticed.

### Coverage of the storage error paths

`db.ts` is at 73%, `validate.ts` at 81%: what is missing is almost exclusively
browser failure branches : database blocked by another tab, storage refused. They
are expensive to simulate and without consequence on the logic. Reported rather
than pursued.

### The reveal timer of a credential is not cancelled when the log changes

Switching logs sets `revealed` to `null` directly instead of going through
`hideRevealed()`, so the 45-second timer is still running and will trigger a
useless render. Without consequence (the value is already removed, and teardown
cleans up), but it is an inconsistency.

### Dynamic tool removal under Chromium ≥ 153

Still unverified, as in every earlier pass : this machine runs Chromium 151. The
policy in force is static and refuses cleanly; that is what the tests
demonstrate, and nothing more is claimed.

---

## What this audit does not cover

- **No performance measurement.** No latency figure is put forward anywhere in
  the repository, and this audit produces none.
- **No test on a browser other than Brave/Chromium 151.** Firefox and Safari do
  not expose WebMCP; the rest of the page has not been exercised there.
- **No third-party cryptographic review of the vault.** The README already says
  that this is not an audited secret manager, and this audit changes nothing about
  that sentence.
