import { describe, expect, it } from 'vitest'
import { StaleStateError, ValidationError } from '../src/domain/errors'
import {
  addConstraint,
  addDecision,
  completeTask,
  createTask,
  evidenceCounts,
  logStep,
  recordRefusal,
  rejectApproach,
  setConstraintActive,
  setNext,
  verifyEvidence,
} from '../src/domain/task'
import { estimateTokens, renderTaskState, TOKEN_BUDGET } from '../src/domain/render'
import type { TaskState } from '../src/domain/types'

function ctx(seed = 0) {
  let n = seed
  return {
    now: 1_700_000_000_000,
    newId: () => `id-${n++}`,
  }
}

function seedTask(): TaskState {
  return createTask({ title: 'Refactor authentication', next: 'Map the system' }, ctx())
}

describe('the version invariant', () => {
  it('bumps the version on every applied mutation', () => {
    let task = seedTask()
    expect(task.version).toBe(1)

    task = addConstraint(
      task,
      { rule: 'Do not touch the schema', basedOnVersion: 1 },
      'agent',
      ctx(10),
    )
    expect(task.version).toBe(2)

    task = logStep(
      task,
      { action: 'Read the module', result: 'three entries', basedOnVersion: 2 },
      'agent',
      ctx(20),
    )
    expect(task.version).toBe(3)

    task = rejectApproach(
      task,
      { approach: 'JWT variante B', reason: 'casse la rotation', basedOnVersion: 3 },
      'agent',
      ctx(30),
    )
    expect(task.version).toBe(4)
  })

  it('refuses a write based on a stale version', () => {
    let task = seedTask()
    task = addConstraint(task, { rule: 'No dependency', basedOnVersion: 1 }, 'human', ctx(10))
    expect(task.version).toBe(2)

    expect(() =>
      logStep(
        task,
        { action: 'Added a library', result: 'ok', basedOnVersion: 1 },
        'agent',
        ctx(20),
      ),
    ).toThrow(StaleStateError)
  })

  it('names both versions in the refusal message', () => {
    const task = seedTask()
    try {
      logStep(task, { action: 'a', result: 'b', basedOnVersion: 45 }, 'agent', ctx())
      expect.unreachable('the write should have been refused')
    } catch (error) {
      expect(error).toBeInstanceOf(StaleStateError)
      const message = (error as StaleStateError).message
      expect(message).toContain('STALE STATE')
      expect(message).toContain('v45')
      expect(message).toContain('v1')
      expect(message).toContain('resume_task')
    }
  })

  it('never refuses a human write', () => {
    let task = seedTask()
    task = logStep(task, { action: 'x', result: 'y', basedOnVersion: 1 }, 'agent', ctx(10))
    task = addConstraint(
      task,
      { rule: 'Interdit de migrer', basedOnVersion: null },
      'human',
      ctx(20),
    )
    expect(task.version).toBe(3)
    expect(task.constraints[0].source).toBe('human')
  })
})

describe('the audit log', () => {
  it('logs a refusal without touching the version or the content', () => {
    const task = seedTask()
    const after = recordRefusal(
      task,
      { operation: 'log_step', actor: 'agent', basedOnVersion: 45, detail: 'stale' },
      ctx(50),
    )
    expect(after.version).toBe(task.version)
    expect(after.steps).toEqual(task.steps)
    expect(after.audit.at(-1)).toMatchObject({ outcome: 'refused', versionAfter: task.version })
  })

  it('records the version before and after every applied mutation', () => {
    let task = seedTask()
    task = addConstraint(task, { rule: 'R', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(task.audit.at(-1)).toMatchObject({
      versionBefore: 1,
      versionAfter: 2,
      outcome: 'applied',
    })
  })
})

describe('degrees of evidence', () => {
  it('downgrades a step with no evidence to "claimed"', () => {
    let task = seedTask()
    task = logStep(
      task,
      { action: 'a', result: 'b', confidence: 'machine_verified', basedOnVersion: 1 },
      'agent',
      ctx(10),
    )
    expect(task.steps[0].confidence).toBe('claimed')
  })

  it('ignores any declared degree: it is derived from what the write carries', () => {
    let task = seedTask()
    task = logStep(
      task,
      {
        action: 'a',
        result: 'b',
        evidence: { kind: 'test_report', content: '183 passed' },
        confidence: 'human_verified',
        basedOnVersion: 1,
      },
      'agent',
      ctx(10),
    )
    expect(task.steps[0].confidence).toBe('evidence')
  })

  it('does not take a link or a diff for a verification', () => {
    let task = seedTask()
    task = logStep(
      task,
      {
        action: 'a',
        result: 'b',
        evidence: { kind: 'url', content: 'https://example.test/build/42' },
        basedOnVersion: 1,
      },
      'agent',
      ctx(10),
    )
    expect(task.steps[0].confidence).toBe('evidence')
  })

  it('reaches "human_verified" only through human validation', () => {
    let task = seedTask()
    task = logStep(
      task,
      { action: 'a', result: 'b', evidence: { kind: 'diff', content: '+1 -1' }, basedOnVersion: 1 },
      'agent',
      ctx(10),
    )
    const stepId = task.steps[0].id
    task = verifyEvidence(task, stepId, '+1 -1', ctx(20))

    expect(task.steps[0].confidence).toBe('human_verified')
    expect(task.steps[0].evidence?.verifiedAt).toBe(1_700_000_000_000)
    expect(evidenceCounts(task).human_verified).toBe(1)
  })

  it('refuses to verify a step with no evidence', () => {
    let task = seedTask()
    task = logStep(task, { action: 'a', result: 'b', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(() => verifyEvidence(task, task.steps[0].id, '', ctx(20))).toThrow(ValidationError)
  })
})

describe('the lifecycle', () => {
  it('refuses every write after completion', () => {
    let task = seedTask()
    task = completeTask(task, { summary: 'Done.', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(task.status).toBe('completed')
    expect(task.next).toBeNull()
    expect(() =>
      logStep(task, { action: 'a', result: 'b', basedOnVersion: 2 }, 'agent', ctx(20)),
    ).toThrow(ValidationError)
  })

  it('refuses to set a next action on a closed task', () => {
    let task = seedTask()
    task = completeTask(task, { summary: 'Done.', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(() =>
      setNext(task, { next: 'one more thing', basedOnVersion: null }, 'human', ctx(20)),
    ).toThrow(ValidationError)
    expect(task.next).toBeNull()
  })

  it('requires a reason for every rejection', () => {
    const task = seedTask()
    expect(() =>
      rejectApproach(task, { approach: 'JWT B', reason: '  ', basedOnVersion: 1 }, 'agent', ctx()),
    ).toThrow(ValidationError)
  })
})

describe('the briefing', () => {
  it('renders active constraints, rejections and the write protocol', () => {
    let task = seedTask()
    task = addConstraint(
      task,
      { rule: 'Never change the schema', basedOnVersion: 1 },
      'human',
      ctx(10),
    )
    task = rejectApproach(
      task,
      { approach: 'JWT variante B', reason: 'casse la rotation', basedOnVersion: null },
      'human',
      ctx(20),
    )

    const output = renderTaskState(task)
    expect(output).toContain('Never change the schema')
    expect(output).toContain('REJECTED: do not retry')
    expect(output).toContain('JWT variante B')
    expect(output).toContain('based_on_version: 3')
  })

  it('omits a deactivated constraint', () => {
    let task = seedTask()
    task = addConstraint(task, { rule: 'Lifted rule', basedOnVersion: 1 }, 'human', ctx(10))
    task = setConstraintActive(task, task.constraints[0].id, false, ctx(20))
    expect(renderTaskState(task)).not.toContain('Lifted rule')
  })

  it('stays under the token budget on a loaded log', () => {
    let task = seedTask()
    for (let i = 0; i < 40; i++) {
      task = logStep(
        task,
        {
          action: `Step number ${i} with a deliberately long label for weight`,
          result: `Result ${i}, also verbose enough to measure degradation`,
          evidence: { kind: 'command_output', content: 'x'.repeat(400) },
          basedOnVersion: task.version,
        },
        'agent',
        ctx(100 + i * 10),
      )
    }
    for (let i = 0; i < 6; i++) {
      task = addConstraint(
        task,
        { rule: `Constraint ${i}`, basedOnVersion: task.version },
        'human',
        ctx(900 + i),
      )
    }

    const output = renderTaskState(task)
    expect(estimateTokens(output)).toBeLessThanOrEqual(TOKEN_BUDGET)
    for (let i = 0; i < 6; i++) expect(output).toContain(`Constraint ${i}`)
  })
})

describe('the briefing budget under pressure', () => {
  function loaded(nbRejets: number, nbConstraints: number): TaskState {
    let task = seedTask()
    let n = 0
    for (let i = 0; i < nbConstraints; i++) {
      task = addConstraint(
        task,
        {
          rule: `Constraint ${i} : worded at length to consume the budget`,
          basedOnVersion: task.version,
        },
        'human',
        ctx(5000 + n++ * 10),
      )
    }
    for (let i = 0; i < nbRejets; i++) {
      task = rejectApproach(
        task,
        {
          approach: `Rejected approach number ${i}`,
          reason: `Reason ${i}, deliberately detailed to occupy room in the output`,
          basedOnVersion: null,
        },
        'human',
        ctx(6000 + n++ * 10),
      )
    }
    return task
  }

  it('shortens lines before dropping any', () => {
    const light = renderTaskState(loaded(2, 2))
    const moyen = renderTaskState(loaded(8, 6))

    expect(light).toContain('deliberately detailed to occupy')
    // Loaded, everything is still there, but cut short.
    for (let i = 0; i < 8; i++) expect(moyen).toContain(`Rejected approach number ${i}`)
    expect(moyen).not.toContain('Reason 7, deliberately detailed to occupy room in the output')
  })

  // never dropping a binding rule rendered 37,800 tokens for two thousand
  // rules, 94 times the budget, and a render the context window truncates in
  // silence. Cut here and say so, or let it be cut elsewhere.
  it('drops obligations as a last resort, and says so plainly', () => {
    const output = renderTaskState(loaded(30, 10))

    expect(output).toContain('Rejected approach number 0')
    expect(output).toContain('REJECTED: do not retry (12 of 30 shown)')
    expect(output).toContain('18 more not shown here. They were ruled out too.')
    expect(output).toContain('read_task_detail on rejections')
  })

  it('says of a dropped rule that it is STILL binding', () => {
    const output = renderTaskState(loaded(0, 40))

    expect(output).toContain('CONSTRAINTS: binding (40)')
    expect(output).toContain('THEY ARE STILL BINDING')
    expect(output).toContain('read_task_detail on constraints')
  })

  it('keeps a floor of obligations, and really bounds the briefing', () => {
    const output = renderTaskState(loaded(0, 300))

    const shown = output.split('\n').filter((l) => l.includes('Constraint ')).length
    expect(shown).toBeGreaterThanOrEqual(12)
    // Without this bound, the same measurement gave 37,800 tokens at 2000
    // rules.
    expect(estimateTokens(output)).toBeLessThan(1000)
  })

  it('shows the same obligations from one call to the next', () => {
    // Cutting from the end would slide the window on every addition: the agent
    // would see a rule it had read disappear, without that rule changing.
    const before = renderTaskState(loaded(0, 40))
    const afterState = renderTaskState(loaded(0, 60))

    expect(before).toContain('Constraint 0')
    expect(afterState).toContain('Constraint 0')
    expect(afterState).toContain('Constraint 11')
  })

  it('holds the budget as long as the constraints allow', () => {
    const task = loaded(4, 3)
    expect(estimateTokens(renderTaskState(task))).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('says how many decisions are shown out of how many', () => {
    let task = seedTask()
    for (let i = 0; i < 6; i++) {
      task = addDecision(
        task,
        { choice: `Choix ${i}`, rationale: `Reason ${i}`, basedOnVersion: task.version },
        'agent',
        ctx(7000 + i * 10),
      )
    }
    const output = renderTaskState(task)
    expect(output).toMatch(/DECISIONS \(last \d+ of 6\)/)
  })

  it('stays deterministic: two renders of the same state are identical', () => {
    const task = loaded(30, 10)
    expect(renderTaskState(task)).toBe(renderTaskState(task))
  })
})
