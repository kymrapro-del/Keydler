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

describe('not repeating what is already written', () => {
  it('refuses a rule word for word identical to a rule in force', () => {
    const rule = activeConstraints(task)[0].rule
    expect(() => addConstraint(task, { rule, basedOnVersion: null }, 'agent')).toThrow(
      ValidationError,
    )
  })

  it('ignores case, spacing and trailing punctuation', () => {
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

  it('says the rule already exists, and already binds', () => {
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

  it('lets a neighbouring but different rule through', () => {
    const next = addConstraint(
      task,
      { rule: 'Never modify the database schema without a migration', basedOnVersion: null },
      'agent',
    )
    expect(next.constraints.length).toBe(task.constraints.length + 1)
  })

  it('does not stop a lifted rule from being set again', () => {
    const rule = activeConstraints(task)[0]
    const lifted = {
      ...task,
      constraints: task.constraints.map((c) => (c.id === rule.id ? { ...c, active: false } : c)),
    }
    expect(() =>
      addConstraint(lifted, { rule: rule.rule, basedOnVersion: null }, 'human'),
    ).not.toThrow()
  })

  it('refuses a rejection already on record too', () => {
    const approach = task.rejected[0].approach
    expect(() =>
      rejectApproach(task, { approach, reason: 'another reason', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('refuses a question already open, word for word', () => {
    const asked = askHuman(
      task,
      { question: 'Which region?', why: 'endpoint', basedOnVersion: null },
      'agent',
    )
    expect(() =>
      askHuman(asked, { question: 'which region?', why: 'again', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('refuses a permission request already pending', () => {
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

  it('tells the agent, through the tool, that nothing was written', async () => {
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

describe('closing a task says what was left hanging', () => {
  it('lists what was never settled', () => {
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

  it('says it to the agent doing the closing, rather than letting it believe everything is settled', async () => {
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
    const text = textOf(result)
    expect(text).toContain('LEFT UNRESOLVED')
    expect(text).toContain('1 question')
    expect(text.toLowerCase()).toContain('proposal')
    store.__resetStore()
  })

  it('says nothing of the sort when everything is settled', async () => {
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

describe('the export carries what was asked and what was disputed too', () => {
  it('renders the permission requests and their outcome', () => {
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

  it('adds no empty section when nothing was asked', () => {
    expect(buildTaskExport(task)).not.toContain('## Permission asked')
  })

  it('marks a disputed step in the attached evidence', () => {
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
