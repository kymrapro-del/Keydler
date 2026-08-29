# The eight measurement tasks

> **Principle.** The ruled-out approach is the good answer, the one a capable
> model proposes on its own, set aside for a reason specific to the project,
> one no model can deduce.
>
> That is the only case worth measuring. Classic anti-patterns, an agent avoids
> on its own : a first design built on them produced a control at zero, recorded
> in [`results.md`](results.md).

For tasks 1 to 4, the ruled-out approach is not an assumption : it is exactly
what the control proposed during the 26 August run.

| #   | Task                           | Ruled-out approach              | Recorded reason (local, not deducible)                                                                                    | Constraint                                |
| --- | ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Keep a session token           | `HttpOnly` cookie               | the API is on another apex domain, and the mobile web view rejects third-party cookies : tried it, sessions kept dropping | no new dependency                         |
| 2   | Paginate a large endpoint      | cursor pagination               | the admin console has to jump to an arbitrary page, which the cursor makes impossible                                     | do not change the shape of the public API |
| 3   | Rate-limit an API              | Redis token bucket              | there is no Redis and operations refuses to add one                                                                       | no new infrastructure                     |
| 4   | Insert a large CSV             | `COPY` into a staging table     | the database user does not have the `COPY` privilege on this cluster                                                      | 512 MB memory ceiling                     |
| 5   | Retry an upstream call         | exponential backoff with jitter | the provider's idempotency window is 30 s; the backoff pushed retries past it, hence double charges                       | do not add a queue                        |
| 6   | Represent monetary amounts     | integers in minor units         | we settle in a three-decimal currency with four-decimal rates : cents were losing precision at reconciliation             | no new dependency                         |
| 7   | Deduplicate jobs               | unique index and `ON CONFLICT`  | the table is partitioned by month, and a cross-partition unique index is not supported on this cluster                    | keep the existing table                   |
| 8   | Cache an expensive computation | single-flight lock              | the computation takes 90 s and the lock held request threads until the pool was exhausted                                 | no new dependency                         |

## Exact statements

1. Persist the user's session token in our browser application.
2. Add pagination to the `/api/orders` listing endpoint, which returns a large result set.
3. Add rate limiting to our HTTP API.
4. Process an uploaded CSV file of customer records and insert the rows into the database.
5. Make our calls to the upstream payments provider resilient to intermittent failures.
6. Store monetary amounts for invoices and their line items.
7. Make sure a job is not processed twice when it is enqueued more than once.
8. Cache the result of an expensive report computation.

## Control instruction

The statement, and nothing else : no constraint, no rejection. This is the state
where the previous conversation has been lost and nothing survived.

```
Answer directly from your own knowledge. Do NOT use any tool.

You are picking up this task: <statement>

Propose concretely how you would do it. Name the specific
technique or mechanism you would use. Keep your answer under
150 words.
```

## Instruction for the condition with the log

The log carries the task, its active constraint and its ruled-out approach with
its reason. The opening instruction is the same as in every D3 run :

```
continue
```

## Scoring

Any answer that keeps the ruled-out mechanism as its main solution counts as a
re-proposal. Mentioning it in order to set it aside is not one.
