import { describe, expect, it } from 'vitest'
import { buildCoreTask, buildDemoTask } from '../src/demo/seed'
import { MAX_TOOL_OUTPUT } from '../src/domain/budget'
import { renderTaskState } from '../src/domain/render'
import { MAX_MATCHES, renderSearch } from '../src/domain/searchResult'
import type { TaskState } from '../src/domain/types'
import { ALL_TOOLS } from '../src/webmcp/tools'

// Character budgets Chrome recommends for WebMCP: 30 per name, 500 per tool
// description, 150 per parameter description, 1.5 k per output. These are not
// hard limits: past them, you run into the agents' own guardrails.
// https://developer.chrome.com/docs/ai/webmcp/secure-tools

const MAX_NAME = 30
const MAX_TOOL_DESCRIPTION = 500
const MAX_PARAM_DESCRIPTION = 150
// Chrome recommends 1.5 k characters per output; `TOKEN_BUDGET` is 400 tokens,
// that is 1600 characters by its own measure: 6.7% above. Dropping to 375 saved
// seventeen characters on an ordinary render and cost an identifier name on
// screen. We measure WITH the task address, which the tool always passes:
// without it, 1484 characters for an output that is really 1528, seen in Brave
// 151, 1.9% above.
const MAX_OUTPUT = 1_600

type Schema = {
  properties?: Record<string, { description?: string; properties?: Schema['properties'] }>
}

function parameters(schema: object | undefined, prefix = ''): [string, { description?: string }][] {
  const props = ((schema ?? {}) as Schema).properties ?? {}
  return Object.entries(props).flatMap(([name, prop]) => [
    [`${prefix}${name}`, prop] as [string, { description?: string }],
    ...(prop.properties ? parameters(prop, `${prefix}${name}.`) : []),
  ])
}

describe('the character budgets Chrome recommends', () => {
  it('holds names under thirty characters', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(MAX_NAME)
      for (const [name] of parameters(tool.inputSchema)) {
        expect(name.split('.').at(-1)!.length, `${tool.name}.${name}`).toBeLessThanOrEqual(MAX_NAME)
      }
    }
  })

  it('holds tool descriptions under five hundred', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION)
    }
  })

  it('holds parameter descriptions under a hundred and fifty', () => {
    for (const tool of ALL_TOOLS) {
      for (const [name, prop] of parameters(tool.inputSchema)) {
        expect((prop.description ?? '').length, `${tool.name}.${name}`).toBeLessThanOrEqual(
          MAX_PARAM_DESCRIPTION,
        )
      }
    }
  })

  it('leaves no description empty', () => {
    // An upper bound invites cutting; cutting down to silence would not be
    // progress. Every tool and every parameter still says something.
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120)
      for (const [name, prop] of parameters(tool.inputSchema)) {
        expect((prop.description ?? '').length, `${tool.name}.${name}`).toBeGreaterThan(8)
      }
    }
  })

  it('bounds search by characters, not by count', () => {
    // Twelve matches of 240 characters make 6296 characters: the match count
    // bounds nothing as long as the excerpts are unbounded.
    const longue = (mot: string, n: number) => `${mot} ` + 'x'.repeat(n)
    const task: TaskState = {
      ...buildCoreTask(),
      steps: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`,
        action: longue('zebra', 400),
        result: longue('zebra', 400),
        evidence: null,
        dispute: null,
        confidence: 'evidence' as const,
        basedOnVersion: i,
        source: 'agent' as const,
        at: 1_700_000_000_000 + i,
      })),
    }

    const text = renderSearch(task, 'zebra', MAX_MATCHES)
    expect(text.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT)

    // And nothing is hidden: the header counts what is shown out of what was
    // found, and says what to do with the rest.
    expect(text).toMatch(/MATCHES {5}\d+ shown of 30 found/)
    expect(text).toContain('more not shown: narrow the query')
  })

  it('renders at least one match, however oversized', () => {
    // Otherwise a single entry bigger than the budget would render an empty
    // answer, and search would no longer find anything at all.
    const task: TaskState = {
      ...buildCoreTask(),
      steps: [
        {
          id: 's0',
          action: 'zebra ' + 'x'.repeat(4000),
          result: 'zebra ' + 'x'.repeat(4000),
          evidence: null,
          dispute: null,
          confidence: 'evidence' as const,
          basedOnVersion: 1,
          source: 'agent' as const,
          at: 1_700_000_000_000,
        },
      ],
    }
    const text = renderSearch(task, 'zebra', MAX_MATCHES)
    expect(text).toContain('1 shown of 1 found')
  })

  it('renders an ordinary briefing within the product budget', () => {
    // `resume_task` is the heaviest output of the set, and the only one that
    // comes near the bound. We measure what the tool really sends: with the
    // task address, which `resume_task` passes on every call.
    for (const [nom, task] of [
      ['core', buildCoreTask()],
      ['demo', buildDemoTask()],
    ] as const) {
      const sent = renderTaskState(task, { url: `http://localhost:5173/t/${task.id}` })
      expect(sent.length, nom).toBeLessThanOrEqual(MAX_OUTPUT)
      // And within reach of Chrome's recommendation, without having aimed for
      // it.
      expect(sent.length, nom).toBeLessThan(1_560)
    }
  })
})

describe('what the cut was not allowed to take', () => {
  const of = (name: string) => ALL_TOOLS.find((t) => t.name === name)!

  // The descriptions are written as multiline templates: a sentence can
  // straddle a line break, which is only a space to whoever reads it. Searching
  // for the raw sentence would make these tests sensitive to the formatting of
  // the source rather than to the message.
  const flat = (name: string) => of(name).description.replace(/\s+/g, ' ')

  // Descriptions cut by a third to fit the budget: a description instructs, the
  // README explains. Here are the instructions that had to survive.
  it('keeps when to call each tool', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description, tool.name).toMatch(/Call this/)
    }
  })

  it('keeps what makes resume_task the first move', () => {
    expect(flat('resume_task')).toContain('BEFORE doing any work')
    expect(flat('resume_task')).toContain('context loss')
    expect(flat('resume_task')).toContain('refused as stale')
  })

  it('keeps the refusal to guess, and the silence that is not an approval', () => {
    expect(flat('ask_human')).toContain('Do NOT guess and carry on')
    expect(flat('request_approval')).toContain('NO ANSWER IS NOT APPROVAL')
    expect(flat('request_approval')).toContain('exactly as a refusal')
  })

  it('keeps that an empty search proves nothing', () => {
    expect(flat('search_task')).toContain('does not prove the work was never attempted')
  })

  it('keeps that an agent proposes and does not order', () => {
    expect(flat('add_constraint')).toContain('PROPOSAL')
    expect(flat('reject_approach')).toContain('PROPOSAL')
    expect(flat('reject_approach')).toContain('cannot forbid an approach on your own')
  })

  it('keeps the mandatory reason on a rejection', () => {
    expect(flat('reject_approach')).toContain('A reason is mandatory')
  })
})
