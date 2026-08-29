import { beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask as buildDemoTask } from '../src/demo/seed'
import { answerQuestion, askHuman, openQuestions, answeredQuestions } from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { renderDetail } from '../src/domain/detail'
import { ValidationError } from '../src/domain/errors'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

describe('a question for the human', () => {
  it('is asked by the agent, and stays open until someone answers', () => {
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

  it('requires a reason: a question without its why cannot be answered', () => {
    expect(() =>
      askHuman(task, { question: 'Should I?', why: '', basedOnVersion: null }, 'agent'),
    ).toThrow(ValidationError)
  })

  it('closes on a human answer, which is kept', () => {
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
    const answered = answerQuestion(asked, id, 'Yes, it changes the checkout copy.')

    expect(openQuestions(answered)).toHaveLength(0)
    expect(answeredQuestions(answered)[0].answer).toBe('Yes, it changes the checkout copy.')
    expect(answeredQuestions(answered)[0].answeredAt).toBeTypeOf('number')
    expect(answered.audit.at(-1)).toMatchObject({ operation: 'answer_question', actor: 'human' })
  })

  it('refuses to answer twice rather than overwrite the first answer', () => {
    const asked = askHuman(
      task,
      { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
      'agent',
    )
    const id = openQuestions(asked)[0].id
    const once = answerQuestion(asked, id, 'eu-west-1')

    expect(() => answerQuestion(once, id, 'us-east-1')).toThrow(ValidationError)
  })

  it('refuses an answer to a question that does not exist', () => {
    expect(() => answerQuestion(task, 'nope', 'anything')).toThrow(ValidationError)
  })

  it('refuses a new question on a closed task', () => {
    const closed = { ...task, status: 'completed' as const }
    expect(() =>
      askHuman(closed, { question: 'a?', why: 'b', basedOnVersion: null }, 'agent'),
    ).toThrow()
  })
})

describe('what the next agent sees of it', () => {
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

  it('puts an open question above the old work', () => {
    const rendered = renderTaskState(withQuestion())

    expect(rendered).toContain('WAITING ON THE HUMAN')
    expect(rendered).toContain('Which of the five telemetry baselines')
    // A conversation picking up again has to see at once that it is blocked,
    // before spending its budget redoing the work.
    expect(rendered.indexOf('WAITING ON THE HUMAN')).toBeLessThan(rendered.indexOf('RECENT WORK'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('renders the human answer, which is the reason for asking', () => {
    const asked = withQuestion()
    const answered = answerQuestion(asked, openQuestions(asked)[0].id, 'Use the p95 baselines.')
    const rendered = renderTaskState(answered)

    expect(rendered).toContain('Use the p95 baselines.')
    expect(rendered).toContain('ANSWERED BY THE HUMAN')
  })

  it('invents no section when nothing was asked', () => {
    const rendered = renderTaskState(task)
    expect(rendered).not.toContain('WAITING ON THE HUMAN')
    expect(rendered).not.toContain('ANSWERED BY THE HUMAN')
  })

  it('reads back in full through read_task_detail', () => {
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
