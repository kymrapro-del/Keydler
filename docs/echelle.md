# Scale and cost, August 28, 2026

The two previous audits were looking for correctness defects. This one looks for
cost defects: what grows without bound, what gets redone for nothing, what stops
being usable once the task fills up.

Everything that follows is measured. The bench is in the repository:

```bash
npm run bench
```

**What this measurement is worth.** The bench runs under jsdom and
fake-indexeddb, like the test suite. Render times there are therefore
pessimistic: jsdom's HTML parser is far slower than a browser's, and it does
neither styling nor layout. What carries over as is: HTML sizes, node counts,
token counts, and the durations of pure functions. They run on the same V8 here
and in Chrome.

The "before" column is not a memory: it comes from the same bench re-run on
`src` restored to `28cf6cc`, the commit that precedes these fixes.

---

## 1. `resume_task` was blowing its own budget by a factor of 94

**Severity: high.** This is the product's central promise: a bounded recap that
fits in an agent's context. `TOKEN_BUDGET` is 400.

| Active rules | Before        | After |
| ------------ | ------------- | ----- |
| 0            | 390           | 390   |
| 10           | 487           | 487   |
| 100          | 2,174         | 553   |
| 1,000        | 19,050        | 554   |
| 2,000        | 37,800 tokens | 554   |

Discarded approaches did worse: 45,247 tokens at 2000.

The degradation ladder could do nothing about it. It cut steps, decisions,
proposals, answers, authorizations, disputes, but never obligations, by
deliberate choice: a rule binds, you do not take it away.

**Why that choice was the wrong one.** A 37,800-token recap does not get read:
it is truncated by the model's context window, silently and out of our reach.
The choice was therefore not "keep everything or cut", but "cut here and say so,
or let it be cut elsewhere without anyone knowing". The whole product argues for
the first option.

**Fix.** Rules and discarded approaches give way last, never below a floor of
twelve, and never silently:

```
CONSTRAINTS: binding (2000)
  [human] Never touch shard 0 without taking a snapshot…
  …
  1988 more not shown here. THEY ARE STILL BINDING.
  Read them with read_task_detail on constraints before you act.
```

The cut is made from the start, not from the end: a sliding window would make a
rule an agent had already read disappear, without anything having changed about
it.

At ten rules, 487 tokens: the floor comes before the budget, and that is
deliberate. The budget is a target, not a guarantee, and it already was before.

---

## 2. Four dashboard lists never stopped

**Severity: high.** Steps had been bounded for a long time (`MAX_ROWS = 8`).
Rules, discarded approaches, questions and authorizations were not. And the page
redraws entirely on every keystroke in the search box.

At 2000 entries, one render round trip:

| List            | HTML before | Nodes before | Time before | HTML after | Nodes after | Time after |
| --------------- | ----------- | ------------ | ----------- | ---------- | ----------- | ---------- |
| Rules           | 1.45 MB     | 10,354       | 559 ms      | 55 kB      | 416         | 25 ms      |
| Discarded       | 1.15 MB     | 12,347       | 560 ms      | 54 kB      | 420         | 31 ms      |
| Questions       | 1.04 MB     | 14,376       | 581 ms      | 54 kB      | 433         | 1.3 ms     |
| Authorizations  | 1.30 MB     | 16,377       | 732 ms      | 55 kB      | 442         | 1.7 ms     |
| Steps (control) | 59 kB       | 448          | 19 ms       | 59 kB      | 448         | 4.1 ms     |

Node counts are flat now: 416 against 404 at ten rules.

**Fix.** A single bounded renderer, shared by the four lists, with a button that
opens the whole list. And, for rules, a sentence when what is out of view still
binds:

> 28 rules still in force are not shown. Open the full list before you rely on
> this one.

**Two more, found by rereading the same mistake.** The task picker displayed one
row per task on the machine, and each row has `needsYou` sweep the steps of its
task for its badge, so the page cost the whole machine and not only the open
task. The list of sealed identifiers was not bounded either. Both go through the
same bounded renderer. The guard test was widened along that dimension: it
varied the contents of one task, not the number of tasks, and would have seen
nothing.

**An ordering we tried and then pulled.** Putting rules in force ahead of lifted
rules guaranteed that a truncation never hides an obligation. But lifting a rule
then made it jump to the bottom of the list, under the cursor of the person who
had just clicked. Insertion order is kept, and it is the count of out-of-frame
obligations that carries the guarantee.

---

## 3. Search folded accents 60,000 times per keystroke

`searchTask` rereads the whole task on every character typed. The folding
(`toLower`, `normalize('NFD')`, `\p{Diacritic}`) was applied to every field and
to the query, on every comparison.

| Over 20,000 steps         | Before   | After   |
| ------------------------- | -------- | ------- |
| Word absent from the task | 21.50 ms | 5.05 ms |
| Very frequent word        | 21.40 ms | 9.37 ms |

Two changes: the query is folded once, and an ASCII string (a command output, a
diff, a URL, a hash) skips the folding, which would have nothing to do there.

**What it costs.** On fully accented text, the ASCII test fails every time and
we pay 13% more. That is the direction of the trade, and it leans the right way
for what this product holds.

The frequent word stays more expensive than the absent one: it builds thousands
of `Match` objects. We deliberately do not stop at the twelfth: the header
announces `12 shown of 4211 found`, and that total is useful information
("narrow the query"), not an implementation detail.

---

## 4. The duplicate guard folded everything, on every comparison

Adding a rule asks "is this already set, word for word?", so a sweep of
everything already set. Each comparison folded both sides.

| Rules already set | Before   | After    |
| ----------------- | -------- | -------- |
| 500               | 0.238 ms | 0.080 ms |
| 1,000             | 0.704 ms | 0.224 ms |
| 2,000             | 1.636 ms | 0.541 ms |

The sweep stays linear (that is the question being asked), but the new item is
folded only once, and the folding benefits from the ASCII fast path.

Search and the guard now share a single definition of "the same word, up to case
and accents". Two places that answered that question differently ended up
contradicting each other in front of the user.

---

## 5. Three renders in ten changed nothing on screen

Rendering is woken by the store, by tool calls, and by tool registrations. Many
of those wake-ups change nothing.

Counted over the interface suite: 30 renders out of 100 produced HTML identical
to the previous one, and still paid for rebuilding the DOM, reattaching every
listener, and restoring focus.

The page now compares the HTML it produces to the one on display. The trap was
remembering the HTML without noticing that the root itself had been replaced: a
test holds that case, because the consequence is a blank page.

---

## 6. Concurrency control reread the whole task for one integer

**Severity: medium, but this is the core.** Two open pages must not be able to
overwrite each other: before writing, we check that the task is indeed at the
version we based ourselves on. The check was about one integer, and obtained it
by pulling back the whole task.

Measured in Chrome, on a 798 kB task:

| Operation                                | Time   |
| ---------------------------------------- | ------ |
| Reread the complete record (the old way) | 2.0 ms |
| Query one index key                      | 0.1 ms |

That was more than half the cost of a write. Under jsdom, `saveTask` at 4000
steps: 8.31 ms with the check, 3.99 ms without.

**Fix.** A compound index on `['id', 'version']` answers "is this task at THIS
version?" without pulling back its contents. It is maintained by IndexedDB from
the task's own fields: unlike a counter copied somewhere else, nothing can drift
from what it holds. The conflict path rereads the record (we do have to say
which version to rebase on), and it alone pays.

`saveTask` at 4000 steps: 8.31 ms → 3.95 ms, which is what a write with no check
at all costs.

`DB_VERSION` goes from 2 to 3. A test opens the database at the old version
before anything else touches it, writes a task into it, then checks that the
migration builds the index on top: it is the migration that would lose real
people's data. Verified in Chrome as well: a 798 kB task survived the upgrade,
and both indexes are there.

---

## 7. The picker kept the whole machine in memory

To draw a collapsed dropdown, the page kept every task on the machine whole, at
all times.

| 20 tasks × 2000 steps | Retained |
| --------------------- | -------- |
| Whole tasks (before)  | 15.9 MB  |
| Summaries (after)     | 6.3 kB   |

The summary carries what the picker displays, plus the "needs you" badge
computed before the task is released. It is computed from the normalized task,
never from the raw record: a second defensive reader, faster but distinct, would
end up answering something other than the first.

Read cost does not move: it is the retained memory that is bounded. The
measurement is the serialized size of what stays attached, a deterministic
proxy, where a worker's heap is too noisy to settle anything.

---

## 8. Startup pulled back every task when it was looking for only one

Without `lastTaskId` (after an import, or on a fresh database), startup read
every task on the machine to keep only one. The write-date index is already
sorted: we only need its keys, and we only go down to the next one if the most
recent is unreadable, exactly as before.

| 30 tasks × 500 steps         | Before  | After  |
| ---------------------------- | ------- | ------ |
| Startup without `lastTaskId` | 22.0 ms | 0.8 ms |

Startup no longer depends on the number of tasks on the machine.

---

## 9. What the agent reads was recomputed on every keystroke

The technical panel shows exactly what `resume_task` would return. That text
costs about 5 ms on a 20,000-step task, and it was rebuilt on every render, so
on every character typed into the search box, for a panel that is collapsed most
of the time.

The task is immutable and replaced whole on every write: comparing identities is
enough. The minute goes into the key because the recap carries a line that
depends on the time ("LAST WRITE …"); without it, the preview would end up lying
about the age of the task.

Interactive render over 20,000 steps (the task does not move, the screen does):
27.7 ms → 25.6 ms. Modest, and that is the real figure, not the 5 ms one could
have hoped for.

On a task loaded with rules, it is another matter entirely, and I had not seen
it when writing the paragraph above. The recap then goes through the degradation
ladder, which rebuilds it half a dozen times to fit inside the budget, and that
started over on every render of the page:

| Idle render, 2000 entries | Before  | After  |
| ------------------------- | ------- | ------ |
| Rules                     | 26.3 ms | 0.9 ms |
| Discarded approaches      | 30.9 ms | 0.7 ms |

The section 1 fix had therefore moved the cost rather than removed it: the recap
was bounded, but we paid for it on every beat of the page. The two together
hold.

In the same vein: history described its 200 entries in order to show twelve.

---

## Measured, and left as is

### A write rewrites the whole document

Every mutation serializes and rewrites the whole task. The cost therefore
follows its size:

| Starting task                         | Per write | Throughput  |
| ------------------------------------- | --------- | ----------- |
| Empty                                 | 0.10 ms   | ~10,000 / s |
| 2000 steps, 667 of them with evidence | 13 ms     | ~80 / s     |

Unchanged by this work. The structural fix (splitting the document across
several records) would require a schema bump and a migration, for a scenario
where eighty writes per second stay far beyond what an agent produces. The
marginal cost of one step, for its part, is flat: 0.008 ms at a thousand steps
as at four thousand.

### The picker rereads every task in full

`listTasks` normalizes every task on the machine to display a collapsed
dropdown: 20 tasks of 5000 steps cost 153 ms. Staying with a single
normalization path is worth more than a second one, faster and bound to drift;
and 20 tasks of 200 steps (the real size) cost 5 ms.

### Section-by-section rendering

The idea: replace only the cards that changed, instead of rebuilding the page.
Measured in Chrome before starting: rewriting the 58 kB of HTML of a complete
page costs 0.7 ms. jsdom gave 15 ms for the same work, twenty times too much.

The gain was therefore capped below the millisecond, against a rewrite of the
dashboard's 2900 lines and a mandatory move to event delegation. Not done. A
render that really changes costs 5.8 ms in Chrome on a 798 kB task, and a
keystroke in the search box 6.9 ms, under the bar of one frame.

It is the measurement that settled it, and it settled against.

### The bundle

173 kB raw, 51 kB gzipped for the JavaScript, 3 kB for the CSS, zero production
dependency other than `idb`. Splitting it into chunks loaded on demand would win
a few kilobytes and would add failure modes to a product that has to work
offline. Not done, deliberately.

---

## What these fixes cost

An optimization that costs nothing has generally changed nothing.

| Item                            | Before         | After                   |
| ------------------------------- | -------------- | ----------------------- |
| `renderTaskState`, 20,000 steps | 3.73 ms        | 4.24 ms                 |
| Search over fully accented text | not applicable | +13%                    |
| One more index entry per write  | not applicable | maintained by IndexedDB |

The first comes from the degradation ladder, which counts one more rung: one
extra full render when the budget is exceeded. An ordinary task never gets
there.

---

## Mutation tests

Forty guarantees broken one by one; the suite must go red every time.

| Guarantee broken                                          | Suite |
| --------------------------------------------------------- | ----- |
| Rules are no longer bounded in the recap                  | red   |
| The "still binding" warning disappears                    | red   |
| Rejections are no longer bounded                          | red   |
| The count of hidden rejections is silenced                | red   |
| The obligation floor drops to zero                        | red   |
| The cut is made from the end rather than the start        | red   |
| `capped` ignores the limit                                | red   |
| The "Show all" button disappears                          | red   |
| The warning about hidden obligations disappears           | red   |
| The hidden-obligation count includes lifted rules         | red   |
| Steps are no longer bounded                               | red   |
| Questions are no longer bounded                           | red   |
| The task picker becomes unbounded again                   | red   |
| The picker's button disappears                            | red   |
| The render skip is removed                                | red   |
| The render is skipped even when the HTML changes          | red   |
| The painted HTML is not forgotten on mount                | red   |
| Accent folding is always skipped                          | red   |
| The guard folds nothing any more                          | red   |
| The guard no longer compares the new item                 | red   |
| The ASCII fast path swallows everything                   | red   |
| The query is no longer folded                             | red   |
| Log pruning is hidden from the caller                     | red   |
| The history button is hidden when everything is pruned    | red   |
| The version check refuses nothing any more                | red   |
| A missing task is taken for a conflict                    | red   |
| The index is queried on the wrong version                 | red   |
| The index is not created at migration                     | red   |
| The database version is not bumped                        | red   |
| The summary keeps the whole task                          | red   |
| The badge is computed too late, so empty                  | red   |
| Memoization ignores the task                              | red   |
| Memoization ignores the identifiers                       | red   |
| History still describes everything to show twelve         | red   |
| The startup fallback walks the index backwards            | red   |
| The startup fallback gives up at the first unreadable one | red   |
| The search filter counter counts wrong                    | red   |
| The ordering of result kinds comes from elsewhere         | red   |
| "All" no longer counts everything                         | red   |
| `listTasks` no longer discards an unreadable task         | red   |

Three of them survived the first attempt, and that is exactly what they are
asked to do: the counts carried by the search filters, their order, and the net
that keeps an unreadable task out of the list were held by nothing. Four more
tests, written afterwards.

A fourth "survivor" was a probe error: my script was mutating the wrong `catch`
in the same file. Recorded, so that it does not later pass for a defect.

---

## Browser verification

Chrome, `npm run dev`, a task of 40 rules and 30 discarded approaches written
directly into IndexedDB then reloaded.

**Observed.** 12 rule rows out of 40, the sentence "28 rules still in force are
not shown", the button "Show all 40 rules"; 12 discarded-approach rows out of 30
with its own button; 360 nodes in `#app`. After the click: 40 rows, the warning
gone, the button turned into "Show fewer", focus still on the button, 499 nodes.
The warning and the button have real computed styles (`rgb(230, 230, 234)`, 15
px, a 152 × 41 px rectangle) and are therefore neither invisible nor unstyled.

**No screenshot.** This environment's capture panel returned empty images while
the DOM itself was answering correctly. I note it rather than present an image
that shows nothing.

**Second pass, after the index and the summary.** The database went from version
2 to 3 in place: a 798 kB task survived the upgrade, both indexes are present,
and the compound index does return `perf01` for the right version and nothing
for a wrong one. A rule added from the screen was written in 20.5 ms end to end.
With `lastTaskId` cleared, the page found its task again on its own. One
keystroke in the search box, frame included: 6.9 ms on that same task.

**An anomaly not reproduced.** On the first attempt, the page stayed on
"Loading…" after the direct write into IndexedDB. After clearing the database
and rewriting the same task, it loaded normally, and an IndexedDB connection
held open in parallel does not reproduce the hang. No mechanism established;
recorded as unexplained rather than closed without action.

---

## What this work does not cover

- **No measurement on a real browser.** The timings come from jsdom, where
  rendering is slower and styling absent. Sizes, nodes and tokens, for their part,
  do not depend on the engine.
- **No measurement on mobile**, nor on a slow machine.
- **No memory measurement**. The task is held whole in memory; nothing has been
  measured on that side.
- **No bound on what a received task can carry** beyond decompression, capped at
  2 MB. A point already flagged in the second audit.
