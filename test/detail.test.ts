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
  it('rend une page bornée et dit combien il reste, avec le décalage suivant', async () => {
    await loadedLog(12)

    const page = textOf(await call(readTaskDetailTool, { section: 'steps', limit: 5 }))
    expect(page).toContain('PAGE        1–5 of 12')
    expect(page).toContain('MORE        7 left, call again with offset: 5')
    expect(page).toContain('Étape 0')
    expect(page).toContain('Étape 4')
    expect(page).not.toContain('Étape 5')
  })

  it('parcourt toute la collection sans trou ni recouvrement', async () => {
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

  it('dit explicitement qu’une section est épuisée, plutôt que de rendre une page muette', async () => {
    await loadedLog(3)
    const page = textOf(await call(readTaskDetailTool, { section: 'steps' }))
    expect(page).toContain('MORE        none, this is the end of the section')
  })

  it('dit qu’une section est vide, sans laisser croire à une panne', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    const page = textOf(await call(readTaskDetailTool, { section: 'decisions' }))
    expect(page).toContain('PAGE        empty, this section holds nothing')
  })

  it('signale un décalage au-delà de la fin, et dit lequel serait valable', async () => {
    await loadedLog(3)
    const page = textOf(await call(readTaskDetailTool, { section: 'steps', offset: 50 }))
    expect(page).toContain('past the end of this section')
    expect(page).toContain('between 0 and 2')
  })

  it('refuse une section inconnue en nommant celles qui existent', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    const result = await call(readTaskDetailTool, { section: 'etapes' })
    expect(result.isError).toBe(true)
    for (const s of SECTIONS) expect(textOf(result)).toContain(s)
  })

  it('refuse une taille de page hors bornes, plutôt que de rendre le cahier entier', async () => {
    await loadedLog(3)
    for (const limit of [0, MAX_LIMIT + 1, -3]) {
      const result = await call(readTaskDetailTool, { section: 'steps', limit })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('limit')
    }
  })
})

describe('lecture ciblée', () => {
  it('tronque la preuve en page, et la rend entière quand on la nomme', async () => {
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

  it('dit qu’un identifiant est inconnu, et combien la section en contient', async () => {
    await loadedLog(2)
    const result = textOf(await call(readTaskDetailTool, { section: 'steps', id: 'inexistant' }))
    expect(result).toContain('No entry with id "inexistant"')
    expect(result).toContain('2 entries')
  })

  it('sépare les propositions du reste, jusque dans le détail', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const reject = ALL_TOOLS.find((t) => t.name === 'reject_approach')!
    await call(reject, writeArgs(task, { approach: 'Approche X', reason: 'supposée' }))

    const page = textOf(await call(readTaskDetailTool, { section: 'proposals' }))
    expect(page).toContain('Approche X')
    expect(page).toContain('standing: proposed')
  })
})

describe('le pointeur reste court, et dit où trouver le reste', () => {
  it('tient sous le budget alors même que le détail est volumineux', async () => {
    await loadedLog(30, 2000)

    const summary = textOf(await call(resumeTaskTool))
    expect(estimateTokens(summary)).toBeLessThanOrEqual(TOKEN_BUDGET)

    expect(summary).toContain('FULL DETAIL')
    expect(summary).toContain('read_task_detail')

    const detail = textOf(await call(readTaskDetailTool, { section: 'steps', limit: 5 }))
    expect(estimateTokens(detail)).toBeGreaterThan(TOKEN_BUDGET)
  })

  it('ne mute rien : c’est le contrat d’une lecture', async () => {
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

describe('ce que resume_task annonce du détail', () => {
  it('renvoie au schéma plutôt que de recopier la liste des sections', () => {
    // A prose enumeration has already fallen behind twice, and every word
    // added here costs an id name in a 400-token budget.
    // The schema's own enumeration cannot drift.
    const rendered = renderTaskState(buildDemoTask())
    expect(rendered).toContain('read_task_detail')
    expect(rendered).toContain('schema')
  })

  it('déclare chaque section dans le schéma de l’outil, sans en oublier', () => {
    const schema = readTaskDetailTool.inputSchema as {
      properties: { section: { enum: string[] } }
    }
    expect([...schema.properties.section.enum].sort()).toEqual([...SECTIONS].sort())
  })
})

describe('section credentials', () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      name: `service-${i}-api-key`,
      purpose: 'Calls the upstream service from the ingestion worker',
      kind: 'api_key' as const,
    }))

  it('rend la liste complète des noms, page par page', () => {
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

  it('ne porte que la projection publique : jamais une valeur, jamais un scellé', () => {
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

  it('dit qu’il n’y en a aucun, sans laisser croire à une panne', () => {
    const output = renderDetail(
      buildDemoTask(),
      { section: 'credentials', offset: 0, limit: 5, id: null },
      [],
    )
    expect(output).toContain('empty')
  })
})
