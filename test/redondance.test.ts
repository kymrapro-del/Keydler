import { beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  askHuman,
  completeTask,
  rejectApproach,
  requestApproval,
} from '../src/domain/task'
import { buildTaskExport } from '../src/export/notebook'
import { ValidationError } from '../src/domain/errors'
import { addConstraintTool, completeTaskTool, rejectApproachTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { call, clearDatabase, currentTask, textOf, writeArgs } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildCoreTask()
})

describe('ne pas répéter ce qui est déjà écrit', () => {
  it('refuse une règle mot pour mot identique à une règle en vigueur', () => {
    const rule = activeConstraints(task)[0].rule
    expect(() => addConstraint(task, { rule, basedOnVersion: null }, 'agent')).toThrow(
      ValidationError,
    )
  })

  it('ignore la casse, les espaces et la ponctuation finale', () => {
    const rule = activeConstraints(task)[0].rule
    for (const variante of [
      rule.toUpperCase(),
      `  ${rule}  `,
      `${rule}.`,
      rule.replace(/ +/g, '  '),
    ]) {
      expect(
        () => addConstraint(task, { rule: variante, basedOnVersion: null }, 'agent'),
        variante,
      ).toThrow(ValidationError)
    }
  })

  it('dit que la règle existe déjà, et qu’elle engage déjà', () => {
    const rule = activeConstraints(task)[0].rule
    const error = (() => {
      try {
        addConstraint(task, { rule, basedOnVersion: null }, 'agent')
      } catch (e) {
        return e as ValidationError
      }
    })()!

    expect(error.message).toContain('already')
    // Strings are compared, not meanings: that has to be said.
    expect(error.message.toLowerCase()).toContain('word for word')
  })

  it('laisse passer une règle voisine mais différente', () => {
    const next = addConstraint(
      task,
      { rule: 'Never modify the database schema without a migration', basedOnVersion: null },
      'agent',
    )
    expect(next.constraints.length).toBe(task.constraints.length + 1)
  })

  it('n’empêche pas de reposer une règle qui avait été levée', () => {
    const rule = activeConstraints(task)[0]
    const lifted = {
      ...task,
      constraints: task.constraints.map((c) => (c.id === rule.id ? { ...c, active: false } : c)),
    }
    expect(() =>
      addConstraint(lifted, { rule: rule.rule, basedOnVersion: null }, 'human'),
    ).not.toThrow()
  })

  it('refuse aussi un rejet déjà consigné', () => {
    const approach = task.rejected[0].approach
    expect(() =>
      rejectApproach(task, { approach, reason: 'another reason', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('refuse une question déjà ouverte, mot pour mot', () => {
    const asked = askHuman(
      task,
      { question: 'Which region?', why: 'endpoint', basedOnVersion: null },
      'agent',
    )
    expect(() =>
      askHuman(asked, { question: 'which region?', why: 'again', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('refuse une demande d’autorisation déjà en attente', () => {
    const asked = requestApproval(
      task,
      { action: 'Drop the table', why: 'irreversible', basedOnVersion: null },
      'agent',
    )
    expect(() =>
      requestApproval(
        asked,
        { action: 'Drop the table', why: 'again', basedOnVersion: null },
        'agent',
      ),
    ).toThrow(ValidationError)
  })

  it('dit à l’agent, par l’outil, que rien n’a été écrit', async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    await store.openPreparedTask(buildCoreTask())

    const rule = activeConstraints(currentTask())[0].rule
    const before = currentTask().version
    const result = await call(addConstraintTool, writeArgs(currentTask(), { rule }))

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('already')
    expect(currentTask().version).toBe(before)

    const rejected = await call(
      rejectApproachTool,
      writeArgs(currentTask(), { approach: currentTask().rejected[0].approach, reason: 'x' }),
    )
    expect(rejected.isError).toBe(true)
    store.__resetStore()
  })
})

describe('clore une tâche dit ce qui restait en suspens', () => {
  it('énumère ce qui n’a jamais été tranché', () => {
    let next = askHuman(
      task,
      { question: 'Which region?', why: 'endpoint', basedOnVersion: null },
      'agent',
    )
    next = addConstraint(next, { rule: 'A proposed rule', basedOnVersion: null }, 'agent')
    next = completeTask(next, { summary: 'Done enough.', basedOnVersion: null }, 'human')

    expect(next.status).toBe('completed')
    expect(next.audit.at(-1)!.detail).toContain('Done enough.')
  })

  it('le dit à l’agent qui referme, plutôt que de le laisser croire tout réglé', async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    let prepared = askHuman(
      buildCoreTask(),
      { question: 'Which region?', why: 'endpoint', basedOnVersion: null },
      'agent',
    )
    prepared = addConstraint(prepared, { rule: 'A proposed rule', basedOnVersion: null }, 'agent')
    await store.openPreparedTask(prepared)

    const result = await call(
      completeTaskTool,
      writeArgs(currentTask(), { summary: 'Done enough.' }),
    )

    expect(result.isError).toBeFalsy()
    const texte = textOf(result)
    expect(texte).toContain('LEFT UNRESOLVED')
    expect(texte).toContain('1 question')
    expect(texte.toLowerCase()).toContain('proposal')
    store.__resetStore()
  })

  it('ne dit rien de tel quand tout est tranché', async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    await store.openPreparedTask({
      ...buildCoreTask(),
      constraints: buildCoreTask().constraints.filter((c) => c.standing !== 'proposed'),
      rejected: buildCoreTask().rejected.filter((r) => r.standing !== 'proposed'),
      steps: [],
    })

    const result = await call(completeTaskTool, writeArgs(currentTask(), { summary: 'All done.' }))
    expect(textOf(result)).not.toContain('LEFT UNRESOLVED')
    store.__resetStore()
  })
})

describe('l’export porte aussi ce qui a été demandé et contesté', () => {
  it('rend les demandes d’autorisation et leur issue', () => {
    const asked = requestApproval(
      task,
      { action: 'Drop the legacy table', why: 'not reversible', basedOnVersion: null },
      'agent',
    )
    const out = buildTaskExport(asked)

    expect(out).toContain('## Permission asked')
    expect(out).toContain('Drop the legacy table')
    expect(out).toContain('not reversible')
  })

  it('n’ajoute pas de section vide quand rien n’a été demandé', () => {
    expect(buildTaskExport(task)).not.toContain('## Permission asked')
  })

  it('marque une étape contestée dans les preuves jointes', () => {
    const step = task.steps.find((s) => s.confidence === 'evidence')!
    const contested: TaskState = {
      ...task,
      steps: task.steps.map((s) =>
        s.id === step.id
          ? { ...s, confidence: 'disputed' as const, dispute: { reason: 'wrong branch', at: 1 } }
          : s,
      ),
    }

    const out = buildTaskExport(contested)
    expect(out).toContain('DISPUTED')
    expect(out).toContain('wrong branch')
  })
})
