# Measurement protocol (Day 6)

> The number announced must be reproducible by a third party from this document
> alone. The results are added after the run, never before.

## What is measured

A single metric, binary: after a loss of context, is the explicitly ruled-out
approach proposed again?

One solid indicator is worth more than three botched ones. This choice
deliberately sets aside any subjective, non-reproducible measure of quality.

## The two conditions

| Condition    | What the agent has                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control      | The statement of the task, and nothing else. No rule, no rejection: this is the state where the previous conversation was lost and nothing survived it. |
| With the log | The log, loaded with the task, its active rule and its ruled-out approach with its reason. Opening instruction: `continue`.                             |

The comparison therefore bears on what the log makes survive, not on the wording
of the instruction.

## Order of execution

The control first. If the ruled-out approach is not really the model's default
reflex, the control will produce no re-proposal and the measurement will measure
nothing. Better to find that out before spending the second condition.

A control close to zero is not a result: it is a fault in the design of the
tasks. The tasks then have to be hardened, not the number dressed up.

## Isolation

The with-log condition goes through the trial build (`npm run trial`, port
5174), without source maps: on the development server, an agent reads all the
code through `fetch` and the isolation is an illusion. See
[`protocole-reprise.md`](../protocoles/reprise.md).

## Collecting the logs

The “Delete this task” button starts again from an empty base between two runs,
without going through the developer tools. It asks for confirmation, naming what
disappears.

Export before deleting. The “Export this task” button produces a file carrying
the compact briefing, the full content of the evidence (which the briefing never
shows), the write log with its refusals, and the full state as JSON. “Export all
tasks” collects the whole device into one file.

This step was added after the fact, and at a price: the logs for tasks 1 to 7 of
the 26 August campaign were destroyed by the reset between runs, before an
export existed. Only the conclusions reported by the agents survive, in
[`mesures/resultats.md`](../mesures/resultats.md). A later campaign will have to
commit its exports to the repository.

## What we record

Any answer that keeps the ruled-out mechanism as its main solution counts as a
re-proposal. Mentioning it in order to set it aside is not one, and the setting
aside must be recorded as it stands, reason included.

## Rules of honesty

- A small gap is reported as it stands. A modest and true result is worth more
  than an unverifiable number.
- The runs share the model and the instruction: their results are correlated. We
  report raw counts (“N out of 8”), never percentages nor confidence intervals,
  which would assume an independence that does not exist.
- No number appears in the video, the description or the README unless it is
  reproducible from this document.

## Results

Without the log, the ruled-out approach is proposed again in 8 cases out of 8.
With the log, in 0 cases out of 8.

Readings, transcripts and reservations in
[`mesures/resultats.md`](../mesures/resultats.md).
