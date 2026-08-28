import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
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

// « undo » n'existe que côté humain : un agent ne révoque pas une décision de
// supervision, c'est précisément ce que le modèle de confiance lui interdit.
const HUMAN_ONLY = ['undo']

describe('le journal met en mots ce que les nouveaux outils écrivent', () => {
  it('ne laisse aucun nom d’opération machine atteindre l’écran', () => {
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

  it('distingue poser une question de répondre à une question', () => {
    expect(describeEntry(entry({ operation: 'ask_human', actor: 'agent' })).what).toBe(
      'asked you a question',
    )
    expect(describeEntry(entry({ operation: 'answer_question', actor: 'human' })).what).toBe(
      'answered a question',
    )
  })

  it('met la tentative à l’infinitif pour les nouveaux outils aussi', () => {
    for (const operation of [...NEW_OPERATIONS, ...HUMAN_ONLY]) {
      const line = describeEntry(entry({ operation, outcome: 'refused', detail: 'stale write' }))
      expect(line.what, operation).toMatch(/^tried to [a-z]/)
      expect(line.what, operation).not.toMatch(/tried to \w+ed\b/)
      expect(line.what, operation).not.toContain('_')
    }
  })
})

describe('ce que l’agent lit d’une annulation', () => {
  it('nomme l’annulation en phrase, jamais par son code', () => {
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
    // Une annulation rétablit une règle : elle change ce que l'agent peut faire.
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
  })
})

describe('les messages humains nomment les champs, pas leurs identifiants', () => {
  const FIELDS: Record<string, string> = {
    question: 'the question',
    why: 'the reason it blocks you',
    answer: 'your answer',
    questionId: 'that question',
    step_id: 'that step',
  }

  it.each(Object.entries(FIELDS))('parle de « %s » comme de « %s »', (field, expected) => {
    const message = humanMessage(
      new ValidationError(field, 'must not be empty.', { code: 'empty' }),
      'Saving',
    )
    expect(message).toContain(expected)
    expect(message).not.toContain(`“${field}”`)
  })
})

describe('la recherche couvre ce qui a été demandé et répondu', () => {
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

  it('trouve une question par ses mots', () => {
    const hits = searchTask(asked(), 'baseline')
    expect(hits.some((h) => h.kind === 'question')).toBe(true)
  })

  it('trouve une réponse humaine, qui est souvent la seule trace d’une décision', () => {
    const hits = searchTask(asked(), 'p95 dashboard')
    expect(hits.some((h) => h.text.includes('Use the p95 dashboard baseline.'))).toBe(true)
  })

  it('dit si la question est encore ouverte', () => {
    const open = askHuman(
      buildDemoTask(),
      { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
      'agent',
    )
    const hit = searchTask(open, 'region').find((h) => h.kind === 'question')!
    expect(hit.label.toLowerCase()).toContain('open')
  })
})

describe('l’export porte tout ce qui a été échangé', () => {
  it('rend les questions et leurs réponses en clair, pas seulement dans le JSON', () => {
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

  it('n’ajoute pas une section vide quand rien n’a été demandé', () => {
    expect(buildTaskExport(buildDemoTask())).not.toContain('## Questions and answers')
  })
})

describe('une preuve jointe après coup se relit comme telle', () => {
  it('apparaît dans la recherche par son contenu', () => {
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

describe('changer la prochaine action laisse une trace lisible', () => {
  it('dit ce que la prochaine action est devenue', () => {
    const next = setNext(buildDemoTask(), 'Benchmark approach C against the p95 baseline')
    expect(next.audit.at(-1)!.detail).toContain('Benchmark approach C')
  })
})
