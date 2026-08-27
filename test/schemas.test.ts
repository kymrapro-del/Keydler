import { describe, expect, it } from 'vitest'
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import { MAX_EVIDENCE_LENGTH, MAX_FIELD_LENGTH } from '../src/domain/validate'

/**
 * Les schémas d'entrée.
 *
 * Un schéma n'est pas de la décoration : c'est la seule partie du contrat que
 * l'agent lit AVANT d'appeler, et donc la seule qui puisse lui éviter un
 * aller-retour. Un schéma lâche déplace tout le travail vers le refus —
 * l'agent essaie, échoue, relit, recommence, et chaque tour coûte un appel de
 * modèle.
 *
 * Ces cas verrouillent trois durcissements, chacun pour une panne distincte.
 */

type Schema = {
  type?: string
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean
  minLength?: number
  maxLength?: number
  enum?: string[]
  pattern?: string
  minimum?: number
  maximum?: number
  description?: string
}

const schemaOf = (name: string): Schema =>
  ALL_TOOLS.find((t) => t.name === name)!.inputSchema as Schema

/** Tous les objets d'un schéma, racine comprise. */
function objets(schema: Schema, chemin = '$'): [string, Schema][] {
  const ici: [string, Schema][] = schema.type === 'object' ? [[chemin, schema]] : []
  const enfants = Object.entries(schema.properties ?? {}).flatMap(([clé, valeur]) =>
    objets(valeur, `${chemin}.${clé}`),
  )
  return [...ici, ...enfants]
}

describe('durcissement', () => {
  it('refuse tout champ inconnu, aux racines COMME dans les objets imbriqués', () => {
    for (const tool of ALL_TOOLS) {
      for (const [chemin, objet] of objets(tool.inputSchema as Schema)) {
        // Sans cela, un champ mal orthographié est accepté puis ignoré :
        // l'agent croit avoir joint une preuve, le cahier n'en a aucune, et
        // rien ne le dit. C'est la panne la plus discrète du lot.
        expect(objet.additionalProperties, `${tool.name} ${chemin}`).toBe(false)
      }
    }
  })

  it('atteint bien l’objet imbriqué qu’on croit vérifier', () => {
    // Garde-fou du garde-fou : si `objets` cessait de descendre, le cas
    // ci-dessus passerait en n'ayant plus rien contrôlé.
    const chemins = objets(schemaOf('log_step')).map(([c]) => c)
    expect(chemins).toContain('$.evidence')
  })

  it('déclare les bornes de longueur que le domaine applique', () => {
    const logStep = schemaOf('log_step')
    // La seule façon d'apprendre qu'un champ plafonne était de le dépasser.
    expect(logStep.properties!.action.maxLength).toBe(MAX_FIELD_LENGTH)
    expect(logStep.properties!.action.minLength).toBe(1)
    expect(logStep.properties!.evidence.properties!.content.maxLength).toBe(MAX_EVIDENCE_LENGTH)
    expect(logStep.properties!.next.maxLength).toBe(400)
    expect(schemaOf('complete_task').properties!.summary.maxLength).toBe(4000)
  })

  it('énumère les natures de preuve plutôt que d’attendre le refus', () => {
    const evidence = schemaOf('log_step').properties!.evidence
    expect(evidence.properties!.kind.enum).toEqual([
      'command_output',
      'diff',
      'url',
      'hash',
      'test_report',
    ])
    expect(evidence.required).toEqual(['kind', 'content'])
  })

  it('exige version et jeton d’idempotence sur chaque écriture', () => {
    for (const tool of WRITE_TOOLS) {
      const schema = tool.inputSchema as Schema
      expect(schema.required).toContain('based_on_version')
      expect(schema.required).toContain('mutation_id')
      expect(schema.properties!.based_on_version.type).toBe('integer')
      expect(schema.properties!.based_on_version.minimum).toBe(1)
      // Le motif exclut l'espace : un identifiant se recopie à l'identique
      // d'un appel à l'autre, et une espace de fin suffirait à en faire un
      // autre — donc à créer le doublon qu'il existe pour empêcher.
      expect(schema.properties!.mutation_id.pattern).toBe('^[A-Za-z0-9_.:-]{8,64}$')
    }
  })

  it('n’exige ni version ni jeton d’une lecture', () => {
    for (const tool of READ_TOOLS) {
      const schema = tool.inputSchema as Schema
      expect(schema.required ?? []).not.toContain('based_on_version')
      expect(schema.required ?? []).not.toContain('mutation_id')
    }
  })

  it('n’accepte que l’objet vide là où l’outil ne prend rien', () => {
    const resume = schemaOf('resume_task')
    // La forme que MCP recommande : `{ type: 'object' }` nu accepterait
    // n'importe quoi.
    expect(resume).toMatchObject({ type: 'object', properties: {}, additionalProperties: false })
  })

  it('borne la pagination dans le schéma, pas seulement à l’exécution', () => {
    const detail = schemaOf('read_task_detail')
    expect(detail.properties!.limit.minimum).toBe(1)
    expect(detail.properties!.limit.maximum).toBe(20)
    expect(detail.properties!.offset.minimum).toBe(0)
    expect(detail.required).toEqual(['section'])
  })

  it('décrit chaque champ : un nom seul ne dit pas quoi y mettre', () => {
    for (const tool of ALL_TOOLS) {
      for (const [nom, prop] of Object.entries((tool.inputSchema as Schema).properties ?? {})) {
        expect(prop.description, `${tool.name}.${nom}`).toBeTruthy()
      }
    }
  })
})

describe('ce que la description doit porter faute d’annotation', () => {
  it('dit le contrat de rejeu, que WebMCP ne sait pas transporter', () => {
    // WebMCP n'a pas d'`idempotentHint` : sa `ToolAnnotations` ne connaît que
    // `readOnlyHint` et `untrustedContentHint`. Ce qui n'est pas transporté
    // doit être écrit là où l'agent le lit.
    for (const tool of WRITE_TOOLS) {
      expect(tool.description, tool.name).toContain('mutation_id')
      const jeton = (tool.inputSchema as Schema).properties!.mutation_id.description!
      expect(jeton).toContain('retry with the SAME mutation_id')
      expect(jeton).toContain('the write happens once')
    }
  })

  it('dit que ce qu’un agent écrit est une proposition', () => {
    const contrainte = ALL_TOOLS.find((t) => t.name === 'add_constraint')!
    const rejet = ALL_TOOLS.find((t) => t.name === 'reject_approach')!
    expect(contrainte.description).toContain('PROPOSAL')
    expect(rejet.description).toContain('PROPOSAL')
    expect(rejet.description).toContain('until a human approves it')
  })

  it('dit qu’une preuve jointe n’est pas une preuve vérifiée', () => {
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    expect(logStep.description).toContain('not as verified')
  })
})
