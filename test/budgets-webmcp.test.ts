import { describe, expect, it } from 'vitest'
import { buildCoreTask, buildDemoTask } from '../src/demo/seed'
import { MAX_TOOL_OUTPUT } from '../src/domain/budget'
import { renderTaskState } from '../src/domain/render'
import { MAX_MATCHES, renderSearch } from '../src/domain/searchResult'
import type { TaskState } from '../src/domain/types'
import { ALL_TOOLS } from '../src/webmcp/tools'

// Budgets de caractères recommandés par Chrome pour WebMCP : 30 par nom, 500 par
// description d'outil, 150 par description de paramètre, 1,5 k par sortie. Ce ne sont
// pas des limites dures — au-delà, on tombe sur les garde-fous des agents.
// https://developer.chrome.com/docs/ai/webmcp/secure-tools

const MAX_NAME = 30
const MAX_TOOL_DESCRIPTION = 500
const MAX_PARAM_DESCRIPTION = 150
// Chrome recommande 1,5 k caractères par sortie ; `TOKEN_BUDGET` vaut 400 tokens, soit
// 1600 caractères à sa mesure — 6,7 % au-dessus. Descendre à 375 gagnait dix-sept
// caractères sur une restitution ordinaire et coûtait un nom d'identifiant à l'écran.
// On mesure AVEC l'adresse de la tâche, que l'outil passe toujours : sans elle, 1484
// caractères pour une sortie qui en fait 1528 — relevé dans Brave 151, 1,9 % au-dessus.
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
    // Une borne haute invite à couper ; couper jusqu'au silence ne serait pas
    // un progrès. Chaque outil et chaque paramètre dit encore quelque chose.
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120)
      for (const [name, prop] of parameters(tool.inputSchema)) {
        expect((prop.description ?? '').length, `${tool.name}.${name}`).toBeGreaterThan(8)
      }
    }
  })

  it('borne la recherche par les caractères, pas par le compte', () => {
    // Douze correspondances de 240 caractères font 6296 caractères : le compte
    // de correspondances ne borne rien tant que les extraits sont libres.
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

    // Et rien n'est caché : l'en-tête compte ce qui est montré sur ce qui a été
    // trouvé, et dit quoi faire du reste.
    expect(texte).toMatch(/MATCHES {5}\d+ shown of 30 found/)
    expect(texte).toContain('more not shown — narrow the query')
  })

  it('rend au moins une correspondance, même démesurée', () => {
    // Sinon une seule entrée plus grosse que le budget rendrait une réponse
    // vide, et la recherche ne trouverait plus rien du tout.
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
    // `resume_task` est la sortie la plus lourde du lot, et la seule qui
    // approche la borne. On mesure ce que l'outil envoie vraiment : avec
    // l'adresse de la tâche, que `resume_task` passe à chaque appel.
    for (const [nom, task] of [
      ['core', buildCoreTask()],
      ['demo', buildDemoTask()],
    ] as const) {
      const envoyé = renderTaskState(task, { url: `http://localhost:5173/t/${task.id}` })
      expect(envoyé.length, nom).toBeLessThanOrEqual(MAX_OUTPUT)
      // Et à portée de la recommandation de Chrome, sans l'avoir visée.
      expect(envoyé.length, nom).toBeLessThan(1_560)
    }
  })
})

describe('ce que la coupe ne devait pas emporter', () => {
  const of = (name: string) => ALL_TOOLS.find((t) => t.name === name)!

  // Les descriptions sont écrites en gabarits multilignes : une phrase peut
  // enjamber un retour à la ligne, qui n'est qu'un espace pour qui la lit.
  // Chercher la phrase brute rendrait ces épreuves sensibles à la mise en
  // forme du source plutôt qu'au message.
  const flat = (name: string) => of(name).description.replace(/\s+/g, ' ')

  // Descriptions raccourcies d'un tiers pour tenir le budget : une description
  // instruit, le README explique. Voici les instructions qui devaient survivre.
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
