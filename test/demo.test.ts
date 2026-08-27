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

describe('le cahier de démonstration montre ce que le produit sait faire', () => {
  it('porte une question posée par un agent, et la réponse humaine', () => {
    // Sans cela, « Try the demo » montre un produit d'il y a trois lots.
    expect(answeredQuestions(task).length).toBeGreaterThan(0)
    expect(answeredQuestions(task)[0].answer).toBeTruthy()
    expect(answeredQuestions(task)[0].why).toBeTruthy()
  })

  it('porte une demande d’autorisation tranchée par l’humain', () => {
    expect(decidedApprovals(task).length).toBeGreaterThan(0)
    expect(decidedApprovals(task).some((a) => a.decision === 'denied')).toBe(true)
  })

  it('porte une étape contestée, avec le motif', () => {
    expect(disputedSteps(task)).toHaveLength(1)
    expect(disputedSteps(task)[0].dispute!.reason).toBeTruthy()
  })

  it('laisse quelque chose à faire à l’humain qui arrive', () => {
    // Une démo entièrement tranchée ne montre aucun des gestes de supervision.
    const proposals = task.constraints.filter((c) => c.standing === 'proposed').length
    const rejections = task.rejected.filter((r) => r.standing === 'proposed').length
    expect(proposals + rejections).toBeGreaterThan(0)
    expect(task.steps.some((s) => s.confidence === 'claimed')).toBe(true)
  })

  it('ne laisse ni question ni autorisation en attente au démarrage', () => {
    // Une démo qui s'ouvre sur un agent bloqué laisserait croire à une panne.
    expect(openQuestions(task)).toHaveLength(0)
    expect(pendingApprovals(task)).toHaveLength(0)
  })

  it('tient toujours dans le budget de restitution', () => {
    expect(estimateTokens(renderTaskState(task))).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('tient toujours dans un lien partageable', async () => {
    expect((await packTask(task)).length).toBeLessThan(6000)
  })

  it('reste reproductible : deux appels donnent le même cahier', () => {
    const a = buildDemoTask()
    const b = buildDemoTask()
    expect(a.version).toBe(b.version)
    expect(a.steps.map((s) => s.action)).toEqual(b.steps.map((s) => s.action))
    expect(a.questions.map((q) => q.question)).toEqual(b.questions.map((q) => q.question))
  })
})
