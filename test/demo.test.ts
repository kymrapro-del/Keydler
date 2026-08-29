import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import {
  answeredQuestions,
  decidedApprovals,
  disputedSteps,
  openQuestions,
  pendingApprovals,
} from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { packTask } from '../src/export/link'

const task = buildDemoTask()

describe('the demo log shows what the product can do', () => {
  it('carries a question asked by an agent, and the human answer', () => {
    // Without this, "Try the demo" shows a product three batches old.
    expect(answeredQuestions(task).length).toBeGreaterThan(0)
    expect(answeredQuestions(task)[0].answer).toBeTruthy()
    expect(answeredQuestions(task)[0].why).toBeTruthy()
    expect(answeredQuestions(task)[0].question).toContain('sessions expire')
  })

  it('carries an approval request settled by the human', () => {
    expect(decidedApprovals(task).length).toBeGreaterThan(0)
    expect(decidedApprovals(task).some((a) => a.decision === 'denied')).toBe(true)
  })

  it('carries a disputed step, with the reason', () => {
    expect(disputedSteps(task)).toHaveLength(1)
    expect(disputedSteps(task)[0].dispute!.reason).toBeTruthy()
  })

  it('leaves something to do for the human who arrives', () => {
    // A demo already fully decided shows none of the supervision gestures.
    const proposals = task.constraints.filter((c) => c.standing === 'proposed').length
    const rejections = task.rejected.filter((r) => r.standing === 'proposed').length
    expect(proposals + rejections).toBeGreaterThan(0)
    expect(task.steps.some((s) => s.confidence === 'claimed')).toBe(true)
  })

  it('leaves no question and no approval pending at startup', () => {
    // A demo that opens on a blocked agent would look like a breakdown.
    expect(openQuestions(task)).toHaveLength(0)
    expect(pendingApprovals(task)).toHaveLength(0)
  })

  it('always fits the briefing budget', () => {
    expect(estimateTokens(renderTaskState(task))).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('always fits in a shareable link', async () => {
    expect((await packTask(task)).length).toBeLessThan(6000)
  })

  it('stays reproducible: two calls give the same log', () => {
    const a = buildDemoTask()
    const b = buildDemoTask()
    expect(a.version).toBe(b.version)
    expect(a.steps.map((s) => s.action)).toEqual(b.steps.map((s) => s.action))
    expect(a.questions.map((q) => q.question)).toEqual(b.questions.map((q) => q.question))
  })
})
