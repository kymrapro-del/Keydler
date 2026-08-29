import { describe, expect, it } from 'vitest'
import { buildCoreTask, buildDemoTask } from '../src/demo/seed'
import { MAX_TOOL_OUTPUT } from '../src/domain/budget'
import { renderTaskState } from '../src/domain/render'
import { MAX_MATCHES, renderSearch } from '../src/domain/searchResult'
import type { TaskState } from '../src/domain/types'
import { ALL_TOOLS } from '../src/webmcp/tools'

// Character budgets Chrome recommends for WebMCP: 30 per name, 500 per tool
// description, 150 per parameter description, 1.5 k per output. These are not hard
// limits: past them, you run into the agents' own guardrails.
// https://developer.chrome.com/docs/ai/webmcp/secure-tools

const MAX_NAME = 30
const MAX_TOOL_DESCRIPTION = 500
const MAX_PARAM_DESCRIPTION = 150
// Chrome recommends 1.5 k characters per output; `TOKEN_BUDGET` is 400 tokens, that is
// 1600 characters by its own measure: 6.7% above. Dropping to 375 saved seventeen
// characters on an ordinary render and cost an identifier name on screen.
// We measure WITH the task address, which the tool always passes: without it, 1484
// characters for an output that is really 1528, seen in Brave 151, 1.9% above.
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

describe('les budgets de caractères que Chrome recommande', () => {
  it('tient les noms sous trente caractères', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(MAX_NAME)
      for (const [name] of parameters(tool.inputSchema)) {
        expect(name.split('.').at(-1)!.length, `${tool.name}.${name}`).toBeLessThanOrEqual(MAX_NAME)
      }
    }
  })

  it('tient les descriptions d’outil sous cinq cents', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION)
    }
  })

  it('tient les descriptions de paramètre sous cent cinquante', () => {
    for (const tool of ALL_TOOLS) {
      for (const [name, prop] of parameters(tool.inputSchema)) {
        expect((prop.description ?? '').length, `${tool.name}.${name}`).toBeLessThanOrEqual(
          MAX_PARAM_DESCRIPTION,
        )
      }
    }
  })

  it('ne laisse aucune description vide', () => {
    // An upper bound invites cutting; cutting down to silence would not be
    // progress. Every tool and every parameter still says something.
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120)
      for (const [name, prop] of parameters(tool.inputSchema)) {
        expect((prop.description ?? '').length, `${tool.name}.${name}`).toBeGreaterThan(8)
      }
    }
  })

  it('borne la recherche par les caractères, pas par le compte', () => {
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

    const texte = renderSearch(task, 'zebra', MAX_MATCHES)
    expect(texte.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT)

    // And nothing is hidden: the header counts what is shown out of what was
    // found, and says what to do with the rest.
    expect(texte).toMatch(/MATCHES {5}\d+ shown of 30 found/)
    expect(texte).toContain('more not shown: narrow the query')
  })

  it('rend au moins une correspondance, même démesurée', () => {
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
    const texte = renderSearch(task, 'zebra', MAX_MATCHES)
    expect(texte).toContain('1 shown of 1 found')
  })

  it('rend une restitution ordinaire dans le budget du produit', () => {
    // `resume_task` is the heaviest output of the set, and the only one that
    // comes near the bound. We measure what the tool really sends: with the
    // task address, which `resume_task` passes on every call.
    for (const [nom, task] of [
      ['core', buildCoreTask()],
      ['demo', buildDemoTask()],
    ] as const) {
      const envoyé = renderTaskState(task, { url: `http://localhost:5173/t/${task.id}` })
      expect(envoyé.length, nom).toBeLessThanOrEqual(MAX_OUTPUT)
      // And within reach of Chrome's recommendation, without having aimed for it.
      expect(envoyé.length, nom).toBeLessThan(1_560)
    }
  })
})

describe('ce que la coupe ne devait pas emporter', () => {
  const of = (name: string) => ALL_TOOLS.find((t) => t.name === name)!

  // The descriptions are written as multiline templates: a sentence can
  // straddle a line break, which is only a space to whoever reads it.
  // Searching for the raw sentence would make these tests sensitive to the
  // formatting of the source rather than to the message.
  const flat = (name: string) => of(name).description.replace(/\s+/g, ' ')

  // Descriptions cut by a third to fit the budget: a description instructs,
  // the README explains. Here are the instructions that had to survive.
  it('garde le moment où appeler chaque outil', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description, tool.name).toMatch(/Call this/)
    }
  })

  it('garde ce qui fait de resume_task le premier geste', () => {
    expect(flat('resume_task')).toContain('BEFORE doing any work')
    expect(flat('resume_task')).toContain('context loss')
    expect(flat('resume_task')).toContain('refused as stale')
  })

  it('garde le refus de deviner, et le silence qui n’est pas un accord', () => {
    expect(flat('ask_human')).toContain('Do NOT guess and carry on')
    expect(flat('request_approval')).toContain('NO ANSWER IS NOT APPROVAL')
    expect(flat('request_approval')).toContain('exactly as a refusal')
  })

  it('garde qu’une recherche vide ne prouve rien', () => {
    expect(flat('search_task')).toContain('does not prove the work was never attempted')
  })

  it('garde qu’un agent propose et n’ordonne pas', () => {
    expect(flat('add_constraint')).toContain('PROPOSAL')
    expect(flat('reject_approach')).toContain('PROPOSAL')
    expect(flat('reject_approach')).toContain('cannot forbid an approach on your own')
  })

  it('garde le motif obligatoire d’un rejet', () => {
    expect(flat('reject_approach')).toContain('A reason is mandatory')
  })
})
