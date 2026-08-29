import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_TOOLS, readTaskDetailTool, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { EVIDENCE_PREVIEW, MAX_LIMIT, SECTIONS, renderDetail } from '../src/domain/detail'
import { buildDemoTask } from '../src/demo/seed'
import { TOKEN_BUDGET, estimateTokens, renderTaskState } from '../src/domain/render'
import { call, clearDatabase, currentTask, textOf, writeArgs } from './helpers'

const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

async function loadedLog(stepCount: number, tailleDePreuve = 40) {
  const task = await store.createAndOpenTask('Tâche chargée', 'Continuer')
  for (let i = 0; i < stepCount; i++) {
    await call(
      logStep,
      writeArgs(currentTask(), {
        action: `Étape ${i}`,
        result: `Résultat ${i}`,
        evidence: { kind: 'command_output', content: `sortie ${i} ` + 'x'.repeat(tailleDePreuve) },
      }),
    )
  }
  return task
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('pagination', () => {
  it('renders a bounded page and says how many are left, with the next offset', async () => {
    await loadedLog(12)

    const page = textOf(await call(readTaskDetailTool, { section: 'steps', limit: 5 }))
    expect(page).toContain('PAGE        1–5 of 12')
    expect(page).toContain('MORE        7 left, call again with offset: 5')
    expect(page).toContain('Étape 0')
    expect(page).toContain('Étape 4')
    expect(page).not.toContain('Étape 5')
  })

  it('walks the whole collection with no gap and no overlap', async () => {
    await loadedLog(12)

    const vues: string[] = []
    let offset = 0
    for (let guard = 0; guard < 10; guard++) {
      const page = textOf(await call(readTaskDetailTool, { section: 'steps', limit: 5, offset }))
      vues.push(...(page.match(/Étape \d+/g) ?? []))
      const next = page.match(/call again with offset: (\d+)/)
      if (!next) break
      offset = Number(next[1])
    }

    expect(vues).toEqual(Array.from({ length: 12 }, (_, i) => `Étape ${i}`))
    expect(new Set(vues).size).toBe(12)
  })

  it('says outright that a section is exhausted, rather than a silent page', async () => {
    await loadedLog(3)
    const page = textOf(await call(readTaskDetailTool, { section: 'steps' }))
    expect(page).toContain('MORE        none, this is the end of the section')
  })

  it('says a section is empty, without looking like a failure', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    const page = textOf(await call(readTaskDetailTool, { section: 'decisions' }))
    expect(page).toContain('PAGE        empty, this section holds nothing')
  })

  it('flags an offset past the end, and says which one would work', async () => {
    await loadedLog(3)
    const page = textOf(await call(readTaskDetailTool, { section: 'steps', offset: 50 }))
    expect(page).toContain('past the end of this section')
    expect(page).toContain('between 0 and 2')
  })

  it('refuses an unknown section by naming the ones that exist', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    const result = await call(readTaskDetailTool, { section: 'etapes' })
    expect(result.isError).toBe(true)
    for (const s of SECTIONS) expect(textOf(result)).toContain(s)
  })

  it('refuses an out-of-bounds page size, rather than returning the whole log', async () => {
    await loadedLog(3)
    for (const limit of [0, MAX_LIMIT + 1, -3]) {
      const result = await call(readTaskDetailTool, { section: 'steps', limit })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('limit')
    }
  })
})

describe('targeted reading', () => {
  it('truncates evidence in a page, and returns it whole when it is named', async () => {
    const long = 'L'.repeat(EVIDENCE_PREVIEW + 500)
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await call(
      logStep,
      writeArgs(task, {
        action: 'Lancé la suite',
        result: 'ok',
        evidence: { kind: 'command_output', content: long },
      }),
    )
    const stepId = currentTask().steps[0].id

    const page = textOf(await call(readTaskDetailTool, { section: 'steps' }))
    expect(page.length).toBeLessThan(long.length)
    expect(page).toContain(`request id "${stepId}" for all of it`)

    const entier = textOf(await call(readTaskDetailTool, { section: 'steps', id: stepId }))
    expect(entier).toContain(long)
    expect(entier).toContain('one entry, in full')
  })

  it('says an id is unknown, and how many the section holds', async () => {
    await loadedLog(2)
    const result = textOf(await call(readTaskDetailTool, { section: 'steps', id: 'inexistant' }))
    expect(result).toContain('No entry with id "inexistant"')
    expect(result).toContain('2 entries')
  })

  it('keeps proposals apart from the rest, right into the detail', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const reject = ALL_TOOLS.find((t) => t.name === 'reject_approach')!
    await call(reject, writeArgs(task, { approach: 'Approche X', reason: 'supposée' }))

    const page = textOf(await call(readTaskDetailTool, { section: 'proposals' }))
    expect(page).toContain('Approche X')
    expect(page).toContain('standing: proposed')
  })
})

describe('the pointer stays short, and says where to find the rest', () => {
  it('stays under budget even when the detail is bulky', async () => {
    await loadedLog(30, 2000)

    const summary = textOf(await call(resumeTaskTool))
    expect(estimateTokens(summary)).toBeLessThanOrEqual(TOKEN_BUDGET)

    expect(summary).toContain('FULL DETAIL')
    expect(summary).toContain('read_task_detail')

    const detail = textOf(await call(readTaskDetailTool, { section: 'steps', limit: 5 }))
    expect(estimateTokens(detail)).toBeGreaterThan(TOKEN_BUDGET)
  })

  it('mutates nothing: that is the contract of a read', async () => {
    await loadedLog(3)
    const before = currentTask()

    await call(readTaskDetailTool, { section: 'steps' })
    await call(readTaskDetailTool, { section: 'audit' })
    await call(resumeTaskTool)

    const after = currentTask()
    expect(after.version).toBe(before.version)
    expect(after.audit).toHaveLength(before.audit.length)
    expect(readTaskDetailTool.annotations?.readOnlyHint).toBe(true)
  })
})

describe('what resume_task announces about the detail', () => {
  it('points at the schema rather than copying out the list of sections', () => {
    // A prose enumeration has already fallen behind twice, and every word added
    // here costs an id name in a 400-token budget. The schema's own enumeration
    // cannot drift.
    const rendered = renderTaskState(buildDemoTask())
    expect(rendered).toContain('read_task_detail')
    expect(rendered).toContain('schema')
  })

  it('declares every section in the tool schema, leaving none out', () => {
    const schema = readTaskDetailTool.inputSchema as {
      properties: { section: { enum: string[] } }
    }
    expect([...schema.properties.section.enum].sort()).toEqual([...SECTIONS].sort())
  })
})

describe('the credentials section', () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      name: `service-${i}-api-key`,
      purpose: 'Calls the upstream service from the ingestion worker',
      kind: 'api_key' as const,
    }))

  it('renders the full list of names, page by page', () => {
    const output = renderDetail(
      buildDemoTask(),
      { section: 'credentials', offset: 0, limit: 5, id: null },
      names(8),
    )
    expect(output).toContain('SECTION     credentials')
    expect(output).toContain('${service-0-api-key}')
    expect(output).toContain('${service-4-api-key}')
    expect(output).not.toContain('${service-5-api-key}')
    expect(output).toMatch(/MORE\s+3 left, call again with offset: 5/)
  })

  it('carries only the public projection: never a value, never a seal', () => {
    const output = renderDetail(
      buildDemoTask(),
      { section: 'credentials', offset: 0, limit: 20, id: null },
      names(3),
    )
    for (const mot of ['ciphertext', 'salt', 'iv', 'iterations', 'sealed:']) {
      expect(output, mot).not.toContain(mot)
    }
    expect(output).toContain('no tool here returns a value')
  })

  it('says there are none, without looking like a failure', () => {
    const output = renderDetail(
      buildDemoTask(),
      { section: 'credentials', offset: 0, limit: 5, id: null },
      [],
    )
    expect(output).toContain('empty')
  })
})
