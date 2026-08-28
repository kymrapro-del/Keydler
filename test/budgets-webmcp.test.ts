import { describe, expect, it } from 'vitest'
import { buildCoreTask, buildDemoTask } from '../src/demo/seed'
import { renderTaskState } from '../src/domain/render'
import { ALL_TOOLS } from '../src/webmcp/tools'

/**
 * Chrome publie des budgets de caractères pour les outils WebMCP : 30 par nom,
 * 500 par description d'outil, 150 par description de paramètre, 1,5 k par
 * sortie. Ce sont des recommandations et non des limites dures — au-delà, on
 * « tombe sur les garde-fous des agents » et l'on obtient de moins bons
 * résultats.
 *
 * Ce fichier les tient. Une description se réécrit à chaque fois qu'on trouve
 * une meilleure formulation, et c'est justement là qu'elle regrossit.
 *
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */

const MAX_NAME = 30
const MAX_TOOL_DESCRIPTION = 500
const MAX_PARAM_DESCRIPTION = 150
/**
 * Chrome recommande 1,5 k caractères par sortie. Le budget du produit,
 * `TOKEN_BUDGET`, vaut 400 tokens, soit 1600 caractères à la mesure qu'il
 * emploie : 6,7 % au-dessus de la recommandation. Descendre à 375 pour tomber
 * pile a été essayé puis retiré — mesuré, cela gagnait dix-sept caractères sur
 * une restitution ordinaire et coûtait un nom d'identifiant à l'écran.
 *
 * C'est donc la borne du produit qui est tenue ici, exprimée dans l'unité de
 * Chrome, et l'écart est écrit plutôt que maquillé. Les restitutions réelles
 * mesurent 1501 et 1484 caractères : la recommandation est tenue à un
 * caractère près, sans l'avoir visée.
 */
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

  it('rend une restitution ordinaire dans le budget du produit', () => {
    // `resume_task` est la sortie la plus lourde du lot, et la seule qui
    // approche la borne.
    for (const [nom, task] of [
      ['core', buildCoreTask()],
      ['demo', buildDemoTask()],
    ] as const) {
      expect(renderTaskState(task).length, nom).toBeLessThanOrEqual(MAX_OUTPUT)
      // Et de fait à portée de la recommandation de Chrome, sans l'avoir visée.
      expect(renderTaskState(task).length, nom).toBeLessThan(1_550)
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

  /**
   * Les descriptions ont été raccourcies d'un tiers pour tenir le budget. La
   * règle appliquée : **une description instruit, le README explique** — on a
   * coupé les justifications, pas les instructions. Ces épreuves nomment les
   * instructions qui devaient survivre à la coupe.
   */
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
