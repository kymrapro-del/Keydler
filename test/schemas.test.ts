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

function objets(schema: Schema, path = '$'): [string, Schema][] {
  const here: [string, Schema][] = schema.type === 'object' ? [[path, schema]] : []
  const enfants = Object.entries(schema.properties ?? {}).flatMap(([key, value]) =>
    objets(value, `${path}.${key}`),
  )
  return [...here, ...enfants]
}

describe('hardening', () => {
  it('refuses any unknown field, at the roots AS WELL AS in nested objects', () => {
    for (const tool of ALL_TOOLS) {
      for (const [path, objet] of objets(tool.inputSchema as Schema)) {
        expect(objet.additionalProperties, `${tool.name} ${path}`).toBe(false)
      }
    }
  })

  it('reaches the nested object one believes is being checked', () => {
    const paths = objets(schemaOf('log_step')).map(([c]) => c)
    expect(paths).toContain('$.evidence')
  })

  it('declares the length bounds the domain enforces', () => {
    const logStep = schemaOf('log_step')
    expect(logStep.properties!.action.maxLength).toBe(MAX_FIELD_LENGTH)
    expect(logStep.properties!.action.minLength).toBe(1)
    expect(logStep.properties!.evidence.properties!.content.maxLength).toBe(MAX_EVIDENCE_LENGTH)
    expect(logStep.properties!.next.maxLength).toBe(400)
    expect(schemaOf('complete_task').properties!.summary.maxLength).toBe(4000)
  })

  it('enumerates the evidence kinds rather than waiting for the refusal', () => {
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

  it('requires a version and an idempotency token on every write', () => {
    for (const tool of WRITE_TOOLS) {
      const schema = tool.inputSchema as Schema
      expect(schema.required).toContain('based_on_version')
      expect(schema.required).toContain('mutation_id')
      expect(schema.properties!.based_on_version.type).toBe('integer')
      expect(schema.properties!.based_on_version.minimum).toBe(1)
      expect(schema.properties!.mutation_id.pattern).toBe('^[A-Za-z0-9_.:-]{8,64}$')
    }
  })

  it('requires neither version nor token of a read', () => {
    for (const tool of READ_TOOLS) {
      const schema = tool.inputSchema as Schema
      expect(schema.required ?? []).not.toContain('based_on_version')
      expect(schema.required ?? []).not.toContain('mutation_id')
    }
  })

  it('accepts only the empty object where the tool takes nothing', () => {
    const resume = schemaOf('resume_task')
    expect(resume).toMatchObject({ type: 'object', properties: {}, additionalProperties: false })
  })

  it('bounds pagination in the schema, not only at run time', () => {
    const detail = schemaOf('read_task_detail')
    expect(detail.properties!.limit.minimum).toBe(1)
    expect(detail.properties!.limit.maximum).toBe(20)
    expect(detail.properties!.offset.minimum).toBe(0)
    expect(detail.required).toEqual(['section'])
  })

  it('describes every field: a name alone does not say what to put in it', () => {
    for (const tool of ALL_TOOLS) {
      for (const [nom, prop] of Object.entries((tool.inputSchema as Schema).properties ?? {})) {
        expect(prop.description, `${tool.name}.${nom}`).toBeTruthy()
      }
    }
  })
})

describe('what the description must carry for lack of an annotation', () => {
  it('states the replay contract, which WebMCP cannot carry', () => {
    for (const tool of WRITE_TOOLS) {
      // The contract lives in the PARAMETER description, not the tool's: that
      // is where an agent reads it while filling in the call, and repeating it
      // in both only inflated a budget Chrome recommends holding to. What
      // matters is that it is said once.
      const theSchema = tool.inputSchema as Schema
      expect(theSchema.required, tool.name).toContain('mutation_id')
      const jeton = theSchema.properties!.mutation_id.description!
      expect(jeton, tool.name).toContain('retry with the SAME mutation_id')
      expect(jeton, tool.name).toContain('the write happens once')
    }
  })

  it('says that what an agent writes is a proposal', () => {
    const contrainte = ALL_TOOLS.find((t) => t.name === 'add_constraint')!
    const rejet = ALL_TOOLS.find((t) => t.name === 'reject_approach')!
    expect(contrainte.description).toContain('PROPOSAL')
    expect(rejet.description).toContain('PROPOSAL')
    expect(rejet.description).toContain('until a human approves it')
  })

  it('says attached evidence is not verified evidence', () => {
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    expect(logStep.description).toContain('not as verified')
  })
})

describe('the shipped descriptions', () => {
  it('let no interpolation empty a reference', () => {
    // `${name}` in a TypeScript template evaluates silently: the global
    // variable `name` is '' in a browser, and the agent receives
    // "write as , and what it is for". Nothing crashes.
    for (const tool of ALL_TOOLS) {
      expect(tool.description, tool.name).not.toMatch(/\bas ,|\{\}|as\s+,/)
      expect(tool.description, tool.name).not.toMatch(/ {2,},/)
    }
  })

  it('spells out the reference syntax where it is quoted', () => {
    for (const tool of ALL_TOOLS) {
      if (!/refer to one as|write as/.test(tool.description)) continue
      expect(tool.description, tool.name).toContain('${name}')
    }
  })
})
