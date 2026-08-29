import { describe, expect, it } from 'vitest'
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import { MAX_EVIDENCE_LENGTH, MAX_FIELD_LENGTH } from '../src/domain/validate'

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
        expect(objet.additionalProperties, `${tool.name} ${chemin}`).toBe(false)
      }
    }
  })

  it('atteint bien l’objet imbriqué qu’on croit vérifier', () => {
    const chemins = objets(schemaOf('log_step')).map(([c]) => c)
    expect(chemins).toContain('$.evidence')
  })

  it('déclare les bornes de longueur que le domaine applique', () => {
    const logStep = schemaOf('log_step')
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
    for (const tool of WRITE_TOOLS) {
      // The contract lives in the PARAMETER description, not the tool's: that
      // is where an agent reads it while filling in the call, and repeating it
      // in both only inflated a budget Chrome recommends holding to. What
      // matters is that it is said once.
      const schéma = tool.inputSchema as Schema
      expect(schéma.required, tool.name).toContain('mutation_id')
      const jeton = schéma.properties!.mutation_id.description!
      expect(jeton, tool.name).toContain('retry with the SAME mutation_id')
      expect(jeton, tool.name).toContain('the write happens once')
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

describe('les descriptions livrées', () => {
  it('n’ont laissé aucune interpolation vider une référence', () => {
    // `${name}` in a TypeScript template evaluates silently: the global
    // variable `name` is '' in a browser, and the agent receives
    // "write as , and what it is for". Nothing crashes.
    for (const tool of ALL_TOOLS) {
      expect(tool.description, tool.name).not.toMatch(/\bas ,|\{\}|as\s+,/)
      expect(tool.description, tool.name).not.toMatch(/ {2,},/)
    }
  })

  it('écrit la syntaxe de référence en toutes lettres là où elle est citée', () => {
    for (const tool of ALL_TOOLS) {
      if (!/refer to one as|write as/.test(tool.description)) continue
      expect(tool.description, tool.name).toContain('${name}')
    }
  })
})
