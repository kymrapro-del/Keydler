# Working conventions

## Commands

| Command          | Effect                                                       |
| ---------------- | ------------------------------------------------------------ |
| `npm run dev`    | Development server on `localhost:5173`                       |
| `npm run trial`  | Trial build without a source map, served on `localhost:5174` |
| `npm run build`  | Type check then production build                             |
| `npm test`       | Invariant tests                                              |
| `npm run lint`   | ESLint                                                       |
| `npm run format` | Prettier, writing                                            |
| `npm run check`  | Types, lint, format, tests, build (what CI runs)             |

`npm run check` must pass before any release. CI runs exactly the same steps: a
remote failure must always be reproducible locally.

## Rules that do not move

WebMCP registration never lives in a component. It runs once, when `src/webmcp`
is imported. When React arrives, its strict mode will mount components twice in
development: a `registerTool` called from a `useEffect` would produce tools that
are duplicated and then destroyed.

No hardcoded visual value outside `src/tokens.css`. Rewriting that file is
enough to change the appearance without touching the logic. That is the contract
that lets two people work in parallel.

The domain knows nothing. `src/domain` imports neither React, nor the DOM, nor
IndexedDB, nor WebMCP. A layer never knows the one that consumes it.

Domain messages are written for an agent. They stay in English and carry the
instruction to follow. It is the interface that translates for the person, in
`src/ui/messages.ts`, never the other way round.

The visible text of the page does not explain the mechanism. A trial showed it:
an agent that reads a page describing its versioning starts putting the
versioning to the test instead of working. The visible text competes with the
tool descriptions for its attention, and it wins.

## Writing a test that proves something

A test that passes before and after a fix proves nothing. For any behavior fix,
check that it fails on the version from before:

```bash
git stash push -q <fixed file>
npx vitest run <the test>          # must fail
git stash pop -q
```

That is what made it possible to put a number on seven lost writes under
concurrency rather than assume them.

## Coverage is for finding dead code

`npm run coverage`. A line that is never reached is first a suspicion of dead
code, then a missing test. Three pieces turned out to be dead: `SCHEMA_VERSION`
which stamped nothing, `TaskNotFoundError` which nobody constructed, and an
origin trial token injector rendered inert by an earlier fix.

Dead code is not neutral: it describes a behavior that does not exist, and the
next person will believe it.

## Measurements

Every campaign goes through `npm run trial`. The development server serves the
source over HTTP: a "browser only" agent reads the whole project there through
`fetch`, and the isolation is an illusion.

Export before resetting. Clearing IndexedDB between two trials destroys the
evidence at the same time as it sanitizes the trial.

## Commit messages

Subject in the imperative. The body explains the _why_ when it is not obvious:
the _what_ is already in the diff. A fix states the observed symptom, not just
the line that changed.
