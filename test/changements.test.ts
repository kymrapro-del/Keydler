import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import {
  addConstraint,
  answerQuestion,
  askHuman,
  logStep,
  openQuestions,
  setConstraintActive,
  setConstraintStanding,
  proposedConstraints,
} from '../src/domain/task'
import { renderChanges } from '../src/domain/changes'
import { estimateTokens } from '../src/domain/render'
import { MAX_AUDIT_ENTRIES } from '../src/domain/types'
import { whatChangedTool, READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { call, clearDatabase, currentTask, textOf } from './helpers'
import type { TaskState } from '../src/domain/types'

describe('ce qui a changé depuis une version', () => {
  let task: TaskState

  beforeEach(() => {
    task = buildDemoTask()
  })

  it('ne dit rien quand rien n’a bougé, sans laisser croire à une panne', () => {
    const rendered = renderChanges(task, task.version)
    expect(rendered).toContain('NOTHING CHANGED')
    expect(rendered).toContain(`v${task.version}`)
  })

  it('nomme ce que l’humain a fait, en phrases, pas en codes', () => {
    const withRule = addConstraint(
      task,
      { rule: 'Do not add Redis', basedOnVersion: null },
      'human',
    )
    const rendered = renderChanges(withRule, task.version)

    expect(rendered).toContain('Do not add Redis')
    expect(rendered).toContain('The human')
    expect(rendered).not.toContain('add_constraint')
  })

  it('sépare ce qui vous engage de ce qui est seulement informatif', () => {
    let next = addConstraint(task, { rule: 'Do not add Redis', basedOnVersion: null }, 'human')
    next = logStep(
      next,
      { action: 'Another agent ran the suite', result: 'green', basedOnVersion: null },
      'agent',
    )
    const rendered = renderChanges(next, task.version)

    // Une nouvelle règle change ce que l'agent a le droit de faire ; une étape
    // consignée par un autre agent ne fait que l'informer.
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).toContain('Do not add Redis')
    expect(rendered).toContain('ALSO HAPPENED')
    expect(rendered).toContain('Another agent ran the suite')
  })

  it('signale une réponse humaine comme le débloquant', () => {
    const asked = askHuman(
      task,
      { question: 'Which baseline?', why: 'Thresholds depend on it.', basedOnVersion: null },
      'agent',
    )
    const answered = answerQuestion(asked, openQuestions(asked)[0].id, 'The p95 baseline.')
    const rendered = renderChanges(answered, asked.version)

    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).toContain('The p95 baseline.')
  })

  it('dit qu’une règle a été levée, ce qui élargit ce qui est permis', () => {
    const rule = task.constraints.find((c) => c.active)!
    const lifted = setConstraintActive(task, rule.id, false)
    expect(renderChanges(lifted, task.version)).toContain('lifted')
  })

  it('dit qu’une proposition a été acceptée, donc devenue contraignante', () => {
    const proposed = addConstraint(
      task,
      { rule: 'Keep the CLI flags stable', basedOnVersion: null },
      'agent',
    )
    const accepted = setConstraintStanding(
      proposed,
      proposedConstraints(proposed).at(-1)!.id,
      'accepted',
    )
    const rendered = renderChanges(accepted, proposed.version)
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).toContain('Keep the CLI flags stable')
  })

  it('avoue quand il ne peut pas remonter aussi loin, plutôt que de sembler complet', () => {
    let big = task
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      big = addConstraint(big, { rule: `Rule number ${i}`, basedOnVersion: null }, 'human')
    }

    const rendered = renderChanges(big, 1)
    // Le journal est borné : prétendre restituer depuis v1 serait un mensonge.
    expect(rendered).toContain('INCOMPLETE')
    expect(rendered).toContain('resume_task')
  })

  it('refuse une version venue du futur plutôt que de rendre une liste vide', () => {
    const rendered = renderChanges(task, task.version + 5)
    expect(rendered).toContain('AHEAD OF THIS PAGE')
    expect(rendered).toContain('resume_task')
  })

  it('reste beaucoup moins cher qu’une relecture complète', () => {
    const withRule = addConstraint(
      task,
      { rule: 'Do not add Redis', basedOnVersion: null },
      'human',
    )
    expect(estimateTokens(renderChanges(withRule, task.version))).toBeLessThan(120)
  })

  it('borne sa réponse quand tout a changé, et dit ce qu’il a laissé', () => {
    let busy = task
    for (let i = 0; i < 40; i++) {
      busy = addConstraint(busy, { rule: `Rule number ${i}`, basedOnVersion: null }, 'human')
    }
    const rendered = renderChanges(busy, task.version)
    expect(estimateTokens(rendered)).toBeLessThan(500)
    expect(rendered).toMatch(/\d+ more/)
  })
})

describe('what_changed', () => {
  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    await store.openPreparedTask(buildDemoTask())
  })

  afterEach(() => {
    store.__resetStore()
  })

  it('est en lecture seule, et rangé avec les lectures', () => {
    expect(whatChangedTool.annotations?.readOnlyHint).toBe(true)
    expect(READ_TOOLS).toContain(whatChangedTool)
    expect(WRITE_TOOLS).not.toContain(whatChangedTool)
  })

  it('répond à la question posée par un refus d’état périmé', async () => {
    const stale = currentTask().version
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Do not add Redis', basedOnVersion: null }, 'human'),
    )

    const rendered = textOf(await call(whatChangedTool, { since_version: stale }))
    expect(rendered).toContain('Do not add Redis')
    expect(rendered).toContain('The human')
  })

  it('exige une version, et la refuse si elle n’en est pas une', async () => {
    for (const bad of [undefined, 0, -3, 'soon', 2.5]) {
      const result = await call(whatChangedTool, { since_version: bad })
      expect(result.isError, String(bad)).toBe(true)
      expect(textOf(result), String(bad)).toContain('since_version')
    }
  })

  it('renonce quand l’exécution est annulée', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await call(whatChangedTool, { since_version: 1 }, controller.signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/cancel/i)
  })
})
