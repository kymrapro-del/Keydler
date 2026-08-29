import { describe, expect, it } from 'vitest'
import { buildCoreTask as buildDemoTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  answerQuestion,
  askHuman,
  attachEvidence,
  openQuestions,
  setConstraintActive,
  setNext,
  undoLastSupervision,
} from '../src/domain/task'
import { renderChanges } from '../src/domain/changes'
import { searchTask } from '../src/domain/search'
import { buildTaskExport } from '../src/export/notebook'
import { humanMessage } from '../src/ui/messages'
import { describeEntry } from '../src/ui/history'
import { ValidationError } from '../src/domain/errors'
import type { AuditEntry, TaskState } from '../src/domain/types'

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'e1',
    operation: 'log_step',
    actor: 'agent',
    versionBefore: 4,
    versionAfter: 5,
    basedOnVersion: 4,
    outcome: 'applied',
    detail: 'Ran the tests',
    at: 1_700_000_000_000,
    ...over,
  }
}

const NEW_OPERATIONS = ['ask_human', 'attach_evidence', 'set_next_action', 'answer_question']

// “undo” exists on the human side only: an agent does not revoke a supervision
// decision, which is precisely what the trust model forbids it.
const HUMAN_ONLY = ['undo']

describe('the log puts what the new tools write into words', () => {
  it('lets no machine operation name reach the screen', () => {
    for (const operation of NEW_OPERATIONS) {
      for (const actor of ['human', 'agent'] as const) {
        const line = describeEntry(entry({ operation, actor }))
        expect(line.what, `${actor}/${operation}`).not.toContain(operation)
        expect(line.what, `${actor}/${operation}`).not.toContain('_')
      }
    }

    for (const operation of HUMAN_ONLY) {
      const line = describeEntry(entry({ operation, actor: 'human' }))
      expect(line.what, operation).not.toContain(operation)
    }
  })

  it('tells asking a question apart from answering one', () => {
    expect(describeEntry(entry({ operation: 'ask_human', actor: 'agent' })).what).toBe(
      'asked you a question',
    )
    expect(describeEntry(entry({ operation: 'answer_question', actor: 'human' })).what).toBe(
      'answered a question',
    )
  })

  it('puts the attempt in the infinitive for the new tools too', () => {
    for (const operation of [...NEW_OPERATIONS, ...HUMAN_ONLY]) {
      const line = describeEntry(entry({ operation, outcome: 'refused', detail: 'stale write' }))
      expect(line.what, operation).toMatch(/^tried to [a-z]/)
      expect(line.what, operation).not.toMatch(/tried to \w+ed\b/)
      expect(line.what, operation).not.toContain('_')
    }
  })
})

describe('what the agent reads of an undo', () => {
  it('names the undo in a sentence, never by its code', () => {
    const withRule = addConstraint(
      buildDemoTask(),
      { rule: 'Do not add Redis', basedOnVersion: null },
      'human',
    )
    const rule = activeConstraints(withRule).at(-1)!
    const lifted = setConstraintActive(withRule, rule.id, false)
    const back = undoLastSupervision(lifted)

    const rendered = renderChanges(back, withRule.version)
    expect(rendered).not.toContain('ran undo')
    expect(rendered).toContain('The human')
    // An undo restores a rule: it changes what the agent may do.
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
  })
})

describe('human messages name the fields, not their identifiers', () => {
  const FIELDS: Record<string, string> = {
    question: 'the question',
    why: 'the reason it blocks you',
    answer: 'your answer',
    questionId: 'that question',
    step_id: 'that step',
  }

  it.each(Object.entries(FIELDS))('talks about “%s” as “%s”', (field, expected) => {
    const message = humanMessage(
      new ValidationError(field, 'must not be empty.', { code: 'empty' }),
      'Saving',
    )
    expect(message).toContain(expected)
    expect(message).not.toContain(`“${field}”`)
  })
})

describe('search covers what was asked and what was answered', () => {
  function asked(): TaskState {
    const base = askHuman(
      buildDemoTask(),
      {
        question: 'Which telemetry baseline should the gate use?',
        why: 'The thresholds are relative to it.',
        basedOnVersion: null,
      },
      'agent',
    )
    return answerQuestion(base, openQuestions(base)[0].id, 'Use the p95 dashboard baseline.')
  }

  it('finds a question by its words', () => {
    const hits = searchTask(asked(), 'baseline')
    expect(hits.some((h) => h.kind === 'question')).toBe(true)
  })

  it('finds a human answer, often the only trace of a decision', () => {
    const hits = searchTask(asked(), 'p95 dashboard')
    expect(hits.some((h) => h.text.includes('Use the p95 dashboard baseline.'))).toBe(true)
  })

  it('says whether the question is still open', () => {
    const open = askHuman(
      buildDemoTask(),
      { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
      'agent',
    )
    const hit = searchTask(open, 'region').find((h) => h.kind === 'question')!
    expect(hit.label.toLowerCase()).toContain('open')
  })
})

describe('the export carries everything that was exchanged', () => {
  it('renders questions and their answers in plain words, not only in the JSON', () => {
    const base = askHuman(
      buildDemoTask(),
      {
        question: 'Which telemetry baseline should the gate use?',
        why: 'The thresholds are relative to it.',
        basedOnVersion: null,
      },
      'agent',
    )
    const answered = answerQuestion(base, openQuestions(base)[0].id, 'Use the p95 baseline.')
    const out = buildTaskExport(answered)

    expect(out).toContain('## Questions and answers')
    expect(out).toContain('Which telemetry baseline should the gate use?')
    expect(out).toContain('Use the p95 baseline.')
    expect(out).toContain('The thresholds are relative to it.')
  })

  it('adds no empty section when nothing was asked', () => {
    expect(buildTaskExport(buildDemoTask())).not.toContain('## Questions and answers')
  })
})

describe('evidence attached afterwards reads back as such', () => {
  it('shows up in search by its content', () => {
    const task = buildDemoTask()
    const claimed = task.steps.find((s) => s.evidence === null)!
    const next = attachEvidence(
      task,
      {
        stepId: claimed.id,
        evidence: { kind: 'command_output', content: 'psql: ALTER TABLE monogram_index' },
        basedOnVersion: null,
      },
      'agent',
    )

    const hits = searchTask(next, 'monogram_index')
    expect(hits.some((h) => h.kind === 'evidence')).toBe(true)
  })
})

describe('changing the next action leaves a readable trace', () => {
  it('says what the next action became', () => {
    const next = setNext(buildDemoTask(), {
      next: 'Benchmark approach C against the p95 baseline',
      basedOnVersion: null,
    })
    expect(next.audit.at(-1)!.detail).toContain('Benchmark approach C')
  })
})
