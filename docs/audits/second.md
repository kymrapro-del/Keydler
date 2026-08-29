# Second audit of 28 August 2026

The [first audit](../audits/premier.md) covered the product as it stood then.
About ten batches of features have followed since, without ever being tested
adversarially. This one targets only those.

**Scope.** `request_approval` and its blocking wait, disputes, the shareable
link, the "Needs you" bar, the anti-repeat guard, storage durability, rule
resumption, the extension of undo, the goal (`DONE WHEN`), copy as text, the
picker badges, the agent-call banner, and the history of an item.

**State at the start:** 755 tests. At the end: 776, of which 21 are new ones
covering what was found.

---

## Defects found and fixed

### 1. A link could blow up the browser of whoever opens it

**Severity: high.** `packTask` bounded the length of the link produced. Nothing
bounded what was received. But the link is opened by the victim: bounding the
output of your own browser protects nobody.

Two payloads built during the audit, both under the bound of 16,000 characters:

| Payload                            | Before                       | After            |
| ---------------------------------- | ---------------------------- | ---------------- |
| A 6 MB title, compressed with gzip | accepted, 6 MB reconstructed | refused          |
| 60,000 steps                       | accepted in 6.2 seconds      | refused in 86 ms |

The gzip compression ratio reaches roughly 1000:1: a few kilobytes of address
are enough to produce several megabytes of it.

**Fix.** Decompression is bounded at 2 MB and stops as soon as the bound is
exceeded, not after. The incoming fragment is refused on top of that beyond the
bound we know how to produce: we accept only what we emit.

### 2. A received log could carry an endless audit log

**Severity: medium.** On write, the audit log is bounded at
`MAX_AUDIT_ENTRIES`. On reading a log that came from elsewhere (a link or a file
import), no bound applied. Normalisation now applies the same one, and keeps the
most recent entries, as on write.

### 3. The first setting of a goal or a next action was not undoable

**Severity: medium.** The audit entry carried `previous` only if the old value
was not empty. "There was nothing" therefore became indistinguishable from
"nothing was recorded", and undo refused to act.

Found by chaining three undos: the third one failed.

**Fix.** The replaced value is always recorded, the empty string saying "there
was nothing". And the comparison normalises `null` and `''`, without which the
second undo would re-propose what it had just undone.

### 4. The history of an item thinned out in silence

**Severity: medium.** The audit log is bounded at `MAX_AUDIT_ENTRIES`. Past that
limit, the history of an old rule lost its entries without saying so, and an
empty history reads as "nothing happened", which is false. The height of it, in
a product that reproaches conversation summaries with exactly that, and while
`what_changed` has been announcing its own trimming from the start.

This point first appeared under "known, not fixed". It was treated afterwards.

**Fix.** `historyOf` no longer returns a list but
`{ entries, mayBeIncomplete }`: the incompleteness travels with the entries, and
not in a neighbouring function that the caller could forget to call. That was
precisely the failure mode to rule out. The History button stays on offer even
with no surviving entry, since hiding the button would amount to keeping the
trimming quiet.

The warning says "may not be the whole history" and not a number: the trimming
marker counts entries, not targets, so we do not know what was dropped for this
item.

### 5. Defensive code that nothing could reach

**Severity: low (debt).** After fix no. 1, the bound placed on the uncompressed
fallback had become unreachable: the input bound strictly dominates it. A
mutation test showed it surviving, which is to say dead. Removed, with a comment
saying why the input bound is enough there.

---

## Two tests that were passing for the wrong reason

They are reported here because a test that passes without demonstrating anything
is worse than a missing test: it inspires a confidence it does not deserve.

1. **The picker badge.** The test checked that a row contained "blocked", on a
   task titled "Blocked task". It was the title that satisfied the assertion. Task
   renamed, assertion moved onto the element.
2. **The two bounds of the link.** Each masked the other: the over-long payload
   failed at decoding anyway, and the oversized uncompressed payload was stopped by
   the input bound. Both tests passed without proving anything. Isolated: a
   perfectly valid log, simply too long, that only the input bound refuses.

In both cases, it is the mutation test that revealed the problem: with the guard
broken, the suite stayed green.

---

## What was exercised and holds

### An approval wait while everything moves

| Trial                               | Result                       |
| ----------------------------------- | ---------------------------- |
| The task is deleted during the wait | `NO ANSWER`, never `ALLOWED` |
| The log is switched during the wait | `NO ANSWER`                  |
| The run is cancelled                | returned in under a second   |

### Undo chains

Three corrections in a row (rename, goal, next action) undone one by one in
reverse order, each restoring exactly its value. The chain stops dead in front
of an agent write, and offers nothing more once everything has been restored.

### Bounds of the recent surfaces

- The picker summary stays under 70 characters with 200 pending proposals.
- The goal survives a close and stays editable afterwards: the human remains in
  charge of a closed task.
- The search filter does not carry over from one log to another.
- The history of an item does not mix two rules, and follows the one that was
  proposed and then accepted.

### Mutation tests: eleven recent guarantees

| Guarantee broken                         | Suite |
| ---------------------------------------- | ----- |
| Decompression bomb accepted              | red   |
| Incoming fragment with no bound          | red   |
| Received audit log with no bound         | red   |
| Empty not normalised at undo             | red   |
| First setting of a goal not undoable     | red   |
| Summary that enumerates everything       | red   |
| Old call presented as recent             | red   |
| History of an item mixing everything     | red   |
| Trimming kept from the caller            | red   |
| Button hidden when everything is trimmed | red   |
| Warning removed from the screen          | red   |

Two of them (the two bounds of the link) were only killed once the tests
described above had been corrected.

---

## Known, not fixed

### The "Needs you" bar stays active on an archived log

Reported in the first audit, still true: archiving is not closing.

### Memory bounds beyond the link

`normalizeTask` bounds the audit log and the mutations, not the steps, the
decisions or the rejections. A received log carrying 40,000 steps would fit
under 2 MB and would be accepted. No surface collapses (they all slice what they
display), but nothing bounds it either.

---

## What this second audit does not cover

- **No browser verification.** The control browser could not be restarted in
  this environment, and I prefer to write that down rather than let anyone believe
  in a verification that did not take place. The tests do exercise the platform's
  real `CompressionStream` and `DecompressionStream`, and not doubles. The browser
  readings from the earlier passes, for their part, still hold.
- **No review of the encryption**, nor of the service worker, nor of the
  manifest: they have not changed since the first audit.
- **No performance measurement**, apart from the two durations quoted for the
  decompression bomb, measured by the test suite and not on a real machine.
