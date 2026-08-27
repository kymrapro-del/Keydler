import { beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { answerQuestion, askHuman, openQuestions, answeredQuestions } from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { renderDetail } from '../src/domain/detail'
import { ValidationError } from '../src/domain/errors'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

describe('une question pour l’humain', () => {
  it('est posée par l’agent, et reste ouverte tant que personne n’a répondu', () => {
    const next = askHuman(
      task,
      {
        question: 'Which of the five telemetry baselines should the gate use?',
        why: 'The thresholds are relative to them and I cannot measure them from here.',
        basedOnVersion: task.version,
      },
      'agent',
    )

    expect(openQuestions(next)).toHaveLength(1)
    expect(answeredQuestions(next)).toHaveLength(0)
    expect(openQuestions(next)[0]).toMatchObject({
      question: 'Which of the five telemetry baselines should the gate use?',
      source: 'agent',
      answer: null,
    })
    expect(next.version).toBe(task.version + 1)
    expect(next.audit.at(-1)).toMatchObject({ operation: 'ask_human', outcome: 'applied' })
  })

  it('exige un motif : une question sans son pourquoi ne se répond pas', () => {
    expect(() =>
      askHuman(task, { question: 'Should I?', why: '', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('se ferme par une réponse humaine, qui est conservée', () => {
    const asked = askHuman(
      task,
      {
        question: 'Is the change user-visible?',
        why: 'It decides the rollout.',
        basedOnVersion: null,
      },
      'agent',
    )
    const id = openQuestions(asked)[0].id
    const answered = answerQuestion(asked, id, 'Yes — it changes the checkout copy.')

    expect(openQuestions(answered)).toHaveLength(0)
    expect(answeredQuestions(answered)[0].answer).toBe('Yes — it changes the checkout copy.')
    expect(answeredQuestions(answered)[0].answeredAt).toBeTypeOf('number')
    expect(answered.audit.at(-1)).toMatchObject({ operation: 'answer_question', actor: 'human' })
  })

  it('refuse de répondre deux fois plutôt que d’écraser la première réponse', () => {
    const asked = askHuman(
      task,
      { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
      'agent',
    )
    const id = openQuestions(asked)[0].id
    const once = answerQuestion(asked, id, 'eu-west-1')

    expect(() => answerQuestion(once, id, 'us-east-1')).toThrow(ValidationError)
  })

  it('refuse une réponse à une question qui n’existe pas', () => {
    expect(() => answerQuestion(task, 'nope', 'anything')).toThrow(ValidationError)
  })

  it('refuse une nouvelle question sur une tâche close', () => {
    const closed = { ...task, status: 'completed' as const }
    expect(() =>
      askHuman(closed, { question: 'a?', why: 'b', basedOnVersion: null }, 'agent'),
    ).toThrow()
  })
})

describe('ce que l’agent suivant en voit', () => {
  function withQuestion(): TaskState {
    return askHuman(
      task,
      {
        question: 'Which of the five telemetry baselines should the gate use?',
        why: 'The thresholds are relative to them and I cannot measure them from here.',
        basedOnVersion: null,
      },
      'agent',
    )
  }

  it('place une question ouverte au-dessus du travail ancien', () => {
    const rendered = renderTaskState(withQuestion())

    expect(rendered).toContain('WAITING ON THE HUMAN')
    expect(rendered).toContain('Which of the five telemetry baselines')
    // Une conversation qui reprend doit voir tout de suite qu'elle est bloquée,
    // avant de dépenser son budget à refaire le travail.
    expect(rendered.indexOf('WAITING ON THE HUMAN')).toBeLessThan(rendered.indexOf('RECENT WORK'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('rend la réponse humaine, qui est la raison d’avoir posé la question', () => {
    const asked = withQuestion()
    const answered = answerQuestion(asked, openQuestions(asked)[0].id, 'Use the p95 baselines.')
    const rendered = renderTaskState(answered)

    expect(rendered).toContain('Use the p95 baselines.')
    expect(rendered).toContain('ANSWERED BY THE HUMAN')
  })

  it('n’invente pas de section quand rien n’a été demandé', () => {
    const rendered = renderTaskState(task)
    expect(rendered).not.toContain('WAITING ON THE HUMAN')
    expect(rendered).not.toContain('ANSWERED BY THE HUMAN')
  })

  it('se relit en entier par read_task_detail', () => {
    const asked = withQuestion()
    const rendered = renderDetail(asked, {
      section: 'questions',
      offset: 0,
      limit: 5,
      id: null,
    })
    expect(rendered).toContain('SECTION     questions')
    expect(rendered).toContain('standing: open')
    expect(rendered).toContain('The thresholds are relative to them')
  })
})
