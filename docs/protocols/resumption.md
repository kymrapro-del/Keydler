# Recovery contract protocol (Day 3)

> What is measured, how, and what we forbid ourselves to conclude.

## The starting state

The demonstration log, built by `src/demo/seed.ts`, and therefore identical on
every run. It carries :

- three active rules, two of them human;
- two ruled-out approaches, with their reasons;
- one next action : “Implement approach C : session-bound refresh tokens”;
- the four degrees of evidence.

The page's call log is cleared before every run.

## The agent

A blank context, with no access to the filesystem or to the shell, which
replicates the target environment, where the agent has nothing but a browser. A
single instruction, identical on every run :

```
continue
```

### Implementation with Claude Code

A temporary directory is not enough : an agent equipped with `Bash`, `Read`,
`Glob` or `Grep` can climb back up to the repository. For a local run over the
CDP bridge, make only the tool search available and inject only the Keydler
server :

```bash
fresh_agent_dir=$(mktemp -d /tmp/watch-log-agent.XXXXXX)
cd "$fresh_agent_dir"

claude \
  --no-chrome \
  --strict-mcp-config \
  --mcp-config '{"mcpServers":{"chrome-watch-log":{"type":"stdio","command":"npx","args":["chrome-devtools-mcp@latest","--browserUrl","http://127.0.0.1:9223","--categoryExperimentalWebmcp"]}}}' \
  --tools "ToolSearch"
```

Before the instruction, `/mcp` must show that `chrome-watch-log` is connected.
This transport check reveals neither the task nor the name of `resume_task`. Do
not use `--continue`, `--resume` or a Claude Desktop conversation that has
access to a local folder.

## What we record

| Code | Question                                       | Verifiable through            |
| ---- | ---------------------------------------------- | ----------------------------- |
| R1   | Is `resume_task` called before any other work? | the page's call log           |
| R2   | Is the next action picked up?                  | mention of approach C         |
| R3   | Is the ruled-out approach set aside?           | explicit mention of variant B |
| R4   | Is an active rule cited?                       | mention of one of the three   |
| R5   | Are steps that were not carried out invented?  | writes in the log             |

R5 is a failure if it is true : an agent that records work it has not done
corrupts the log, and that is worse than a missing citation.

## The late rule scenario

The only one that tells supervision apart from display, and the one in the
video.

1. The agent picks the task up and starts working.
2. The human adds a rule in the meantime. The version advances.
3. The agent's next write is refused for stale state.
4. The agent calls `resume_task` again, discovers the rule, and complies with
   it.

We record : whether the refusal took place, whether the agent called the pointer
again on its own, and whether it respected the rule it could not have known.

## The agent's isolation is not a given

Forbidding the agent to use a file tool is not enough. The Vite development
server serves the whole source over HTTP : from the page, a plain
`fetch('/src/domain/task.ts')` returns 200. A “browser only” agent can therefore
read the entire project, including the demonstration log and this protocol.

It happened, on the third run. The agent read `seed.ts`, `render.ts` and
`task.ts` through the page, and drew its “ground truth” from them. The
instruction was followed to the letter and worked around in fact.

Rule for the runs that follow. Serve the trial build :

```bash
npm run trial      # build without source maps, then preview on 5174
```

Source maps are disabled by `TRIAL=1`, without which `dist/assets/*.js.map`
reconstitutes the entire code.

Check, made on 26 August :

| Server             | Body served for `/src/domain/task.ts` | Type              |
| ------------------ | ------------------------------------- | ----------------- |
| 5174 (trial)       | `index.html`, SPA fallback            | `text/html`       |
| 5173 (development) | the real TypeScript                   | `text/javascript` |

The HTTP status alone proves nothing : both answer 200, because the trial server
returns the home page for any unknown route. You have to look at the content
type or the body. Checking the status is what first made me conclude, wrongly,
that the isolation had failed.

In the bundle, `buildDemoTask`, `MACHINE_EVIDENCE_KINDS` and `appendAudit` are
minified and cannot be found.

Any run where the agent retrieved source is declared void for what it concludes
about the content; its purely behavioural observations remain valid.

## What we forbid ourselves to conclude

- The runs are not independent. Same model, same instruction : their results are
  correlated, and n runs are not worth n independent observations. No percentage
  will be put forward.
- This is not the built-in browser of ChatGPT. The MCP bridge exposes the
  tools on demand; the discovery path is not the same.
- A failure on R1 puts the description in question. A failure on R2–R4 puts the
  briefing format in question. The two are fixed separately.
