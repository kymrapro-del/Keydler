# Measurement records

## 26 August 2026, control, first design of the tasks : invalid design

Four control runs executed out of eight planned. No re-proposal.

| #   | Ruled-out approach        | What the control proposed                            | Re-proposed? |
| --- | ------------------------- | ---------------------------------------------------- | ------------ |
| 1   | `localStorage`            | `HttpOnly` cookie, ruling out `localStorage` by name | no           |
| 2   | `OFFSET` / `LIMIT`        | cursor pagination, ruling out `OFFSET` by name       | no           |
| 3   | in-memory counter         | Redis token bucket, shared across replicas           | no           |
| 4   | load the file into memory | stream parsing, “stream-parse, don't slurp”          | no           |

The remaining four were not run : the design is what is at fault, and four more
runs would not have changed it.

### Why this was wrong

I had picked classic anti-patterns, believing they were the default reflex. They
are the opposite : they are the mistakes every capable model has learned to
avoid, and that it rules out by name without being asked.

So there was nothing to measure : the control could only score zero.

### What this teaches about the product

The lesson goes beyond the measurement, and it is more interesting than what I
was trying to establish.

The value of a watch log is not to prevent naive mistakes. A capable agent
avoids those on its own. It is to make the decisions specific to the project
survive : the ones no model can deduce, because they rest on a local constraint,
on a past incident, on a trade-off that left no trace anywhere else.

Put another way, what has to be ruled out in the log is not the bad answer, it
is the good answer, set aside for a local reason. That is exactly the case where
an agent, on its own, will make the wrong choice again with the best intentions.

### Consequence

The eight tasks are redone on that principle. See [`tasks.md`](tasks.md).

## 26 August 2026, control, rebuilt design : 8 out of 8

Same instruction, same statements. For tasks 1 to 4, these are the runs already
reported above : the statement did not change, only the status of what is ruled
out changed.

| #   | Ruled-out approach              | What the control proposed                                  | Re-proposed? |
| --- | ------------------------------- | ---------------------------------------------------------- | ------------ |
| 1   | `HttpOnly` cookie               | “server-set `HttpOnly` cookie”                             | yes          |
| 2   | cursor pagination               | “cursor-based (keyset) pagination”                         | yes          |
| 3   | Redis token bucket              | “token bucket… with Redis as the shared counter store”     | yes          |
| 4   | `COPY` into a staging table     | “bulk-load to a staging table via `COPY … FROM STDIN`”     | yes          |
| 5   | exponential backoff with jitter | “bounded retry with exponential backoff + full jitter”     | yes          |
| 6   | integers in minor units         | “integers in minor units, never floats”                    | yes          |
| 7   | unique index and `ON CONFLICT`  | “uniqueness constraint… `INSERT … ON CONFLICT DO NOTHING`” | yes          |
| 8   | single-flight lock              | “single-flight via `SET lock:{key} NX PX 30000`”           | yes          |

Without the log, the ruled-out approach is proposed again in 8 cases out of 8.

To read this correctly : these are not bad answers. They are the good ones, and
they are well argued. The control does not show incompetence : it shows that no
model can guess a local reason that left no trace anywhere.

The condition with the log is still to be run.

## 26 August 2026, condition with the log

Isolated trial build, log loaded through `?measure=N`, instruction `continue`.

### Task 1: session token · ruled-out approach not proposed again

The agent set the `HttpOnly` cookie aside, quoting the local reason word for
word : “_No cookie is involved at all, so the failure already recorded as
rejected (different apex domain, mobile web view dropping third-party cookies)
simply cannot recur._” It settled on a non-extractable `CryptoKey` in IndexedDB,
and explicitly checked the “no new dependency” constraint.

### Task 2: pagination · ruled-out approach not proposed again

“_Did not retry keyset/cursor. It's on the record with a reason that still
holds. Re-deriving it is the exact waste this page exists to prevent._”

It settled on `OFFSET`, normally the wrong answer, here the only one that
satisfies the local constraint. The log inverted the conclusion, which is
exactly the intended effect.

### Task 3: void run

The agent explored `?measure=1` through `8`, read IndexedDB, recovered the
records of runs 1 and 2, and deduced the whole setup. It then refused to play
the run out : “_I am the wrong instrument : I have now read scenario 3's trap and
constraint in detail, so I am unblinded and any answer I gave would be worthless
as a measurement._”

A correct refusal, and the second failure of my isolation. After the source read
through `fetch`, this time it was the setup itself that was enumerable : the
eight logs are reachable from the same page, and IndexedDB kept the results of
the previous runs.

**Protocol fix.** IndexedDB is cleared before each run, and a single
measurement log exists at a time. Enumeration through `?measure=N` remains
possible and has to be reported as a limit : it is the price of a setup that can
be replayed by URL.

### Four defects found by this run, all verified and fixed

1. **The provenance of a rejection was not given back to the agent.**
   Constraints carried `[human]` / `[agent]`, rejections carried nothing : a human
   veto and an agent's conjecture read identically. This is the most serious one :
   an agent that wrongly rules out the good approach invisibly poisons every
   conversation that follows, and two measurement logs already carried rejections
   written by agents.
2. **The “Reset” button only emptied the call log**, without touching the log
   itself. An operator running one trial after another would have thought they were
   starting from scratch. Renamed.
3. **Each load of `?measure=N` added a row** instead of rewriting the same one. A
   measurement store that grows on every load is not usable. Stable identifier.
4. **A step with no evidence at all appeared nowhere**, while the queue showed
   only the steps that were already backed : priority inverted. You cannot “verify”
   what has nothing to verify, but it has to be flagged. A “Claimed without
   evidence” section was added.

### Tasks 3 to 8 · ruled-out approach not proposed again in the six cases

Database emptied before each run, a single log in memory, instruction
`continue`.

| #   | Ruled out                       | Kept by the agent                                                   |
| --- | ------------------------------- | ------------------------------------------------------------------- |
| 3   | Redis token bucket              | GCRA in the process memory                                          |
| 4   | `COPY` into a staging table     | streaming + multi-row `INSERT` in bounded batches                   |
| 5   | exponential backoff with jitter | retries at a constant interval, bounded by the idempotency deadline |
| 6   | integers in minor units         | `NUMERIC(28,8)` and fixed point in `BigInt`                         |
| 7   | unique index and `ON CONFLICT`  | a separate idempotency ledger, not partitioned                      |
| 8   | single-flight lock              | background refresh, non-blocking marker                             |

## Result

> Without the log, the ruled-out approach is proposed again in 8 cases out of 8.
> With the log, in 0 cases out of 8.

### What this number does not say

- **Eight runs per condition, same model, same instruction.** The results are
  correlated : these are not sixteen independent observations. No percentage and no
  interval will be drawn from them.
- **The control does not show incompetence.** Its eight answers are good and
  argued : `HttpOnly` cookie, cursor pagination, Redis token bucket, `COPY`,
  exponential backoff, minor units, unique index, single-flight. They are the
  textbook answers. They are wrong here, and only here.
- **This is not ChatGPT's built-in browser** but an MCP bridge.
- Enumerating the eight logs through `?measure=N` is still possible from the
  page. It is the price of a setup that can be replayed by URL, and one run took
  advantage of it, the one declared void above.

### What the number hides, and which is worth more than it

No agent avoided the ruled-out approach by dodging a keyword. All of them read
the reason and took from it the part that was still valid.

- Task 3: “_what was rejected is the Redis backing, not the bucket algorithm_”.
  It keeps a bucket, in memory.
- Task 6: “_the approach failed because the scale was pinned to the minor unit,
  not because integers were used_”. It keeps integers, at scale 8.
- Task 8: “_the defect was the waiting, not the deduplication_”. It keeps the
  deduplication, without blocking.

That is the direct justification for one design choice : a rejection without a
reason is refused by the domain. Without the reason, these three agents would
have avoided a word and lost the idea.

Two behaviours deserve to be noted separately.

**Task 4: the agent disputed the reason and respected it anyway.** It notes that
`COPY FROM STDIN` does not require, on recent Postgres, the privilege the
rejection invokes. It does not take that as a licence : “_the entry says not to
retry; the whole point of the log is that a recorded rejection is not re-judged
by an agent who was not there_”. It escalates its disagreement to the human.

**Task 7: the agent spotted the disguised trap.** It sets aside
`UNIQUE (idempotency_key, month)`, legal on Postgres but deduplicating only
inside a partition : “_this is the rejected approach under another name, and the
most likely mistake for anyone who thinks they are fixing it_”.

## Note on the missing exhibits

The watch logs themselves (what each agent actually wrote into the log) were not
kept for tasks 1 to 7. I was emptying IndexedDB between two runs to guarantee
isolation, and no export existed then : the reset destroyed the exhibit at the
same time as it cleaned up the run.

What remains is each agent's report, quoted above. That is enough for the binary
record, which is the measurement, but not enough for a third party to re-examine
the recorded decisions.

The export now exists, and the protocol requires running it before any reset. A
later campaign will deposit its files here.
