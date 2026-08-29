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

describe('what changed since a version', () => {
  let task: TaskState

  beforeEach(() => {
    task = buildDemoTask()
  })

  it('says nothing when nothing moved, without looking like a failure', () => {
    const rendered = renderChanges(task, task.version)
    expect(rendered).toContain('NOTHING CHANGED')
    expect(rendered).toContain(`v${task.version}`)
  })

  it('names what the human did, in sentences, not in codes', () => {
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

  it('separates what binds you from what only informs', () => {
    let next = addConstraint(task, { rule: 'Do not add Redis', basedOnVersion: null }, 'human')
    next = logStep(
      next,
      { action: 'Another agent ran the suite', result: 'green', basedOnVersion: null },
      'agent',
    )
    const rendered = renderChanges(next, task.version)

    // A new rule changes what the agent may do; a step logged by another agent
    // only informs it.
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).toContain('Do not add Redis')
    expect(rendered).toContain('ALSO HAPPENED')
    expect(rendered).toContain('Another agent ran the suite')
  })

  it('flags a human answer as what unblocks it', () => {
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

  it('says a rule was lifted, which widens what is allowed', () => {
    const rule = task.constraints.find((c) => c.active)!
    const lifted = setConstraintActive(task, rule.id, false)
    expect(renderChanges(lifted, task.version)).toContain('lifted')
  })

  it('says a proposal was accepted, and so has become binding', () => {
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

  it('admits when it cannot go back that far, rather than seeming complete', () => {
    let big = task
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      big = addConstraint(big, { rule: `Rule number ${i}`, basedOnVersion: null }, 'human')
    }

    const rendered = renderChanges(big, 1)
    // The audit log is bounded: claiming to replay from v1 would be a lie.
    expect(rendered).toContain('INCOMPLETE')
    expect(rendered).toContain('resume_task')
  })

  it('refuses a version from the future rather than returning an empty list', () => {
    const rendered = renderChanges(task, task.version + 5)
    expect(rendered).toContain('AHEAD OF THIS PAGE')
    expect(rendered).toContain('resume_task')
  })

  it('stays far cheaper than a full re-read', () => {
    const withRule = addConstraint(
      task,
      { rule: 'Do not add Redis', basedOnVersion: null },
      'human',
    )
    expect(estimateTokens(renderChanges(withRule, task.version))).toBeLessThan(120)
  })

  it('bounds its answer when everything changed, and says what it left out', () => {
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

  it('is read-only, and filed with the reads', () => {
    expect(whatChangedTool.annotations?.readOnlyHint).toBe(true)
    expect(READ_TOOLS).toContain(whatChangedTool)
    expect(WRITE_TOOLS).not.toContain(whatChangedTool)
  })

  it('answers the question a stale-state refusal raises', async () => {
    const stale = currentTask().version
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Do not add Redis', basedOnVersion: null }, 'human'),
    )

    const rendered = textOf(await call(whatChangedTool, { since_version: stale }))
    expect(rendered).toContain('Do not add Redis')
    expect(rendered).toContain('The human')
  })

  it('requires a version, and refuses it if it is not one', async () => {
    for (const bad of [undefined, 0, -3, 'soon', 2.5]) {
      const result = await call(whatChangedTool, { since_version: bad })
      expect(result.isError, String(bad)).toBe(true)
      expect(textOf(result), String(bad)).toContain('since_version')
    }
  })

  it('gives up when the call is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await call(whatChangedTool, { since_version: 1 }, controller.signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/cancel/i)
  })
})
