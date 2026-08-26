import { describe, expect, it } from 'vitest'
import { StaleStateError, ValidationError } from '../src/domain/errors'
import {
  addConstraint,
  completeTask,
  createTask,
  evidenceCounts,
  logStep,
  recordRefusal,
  rejectApproach,
  setConstraintActive,
  verifyEvidence,
} from '../src/domain/task'
import { estimateTokens, renderTaskState, TOKEN_BUDGET } from '../src/domain/render'
import type { TaskState } from '../src/domain/types'

/** Contexte déterministe : sans lui, les identifiants et dates polluent les assertions. */
function ctx(seed = 0) {
  let n = seed
  return {
    now: 1_700_000_000_000,
    newId: () => `id-${n++}`,
  }
}

function seedTask(): TaskState {
  return createTask({ title: 'Refactoriser l’authentification', next: 'Cartographier' }, ctx())
}

describe('invariant de version', () => {
  it('incrémente la version à chaque mutation appliquée', () => {
    let task = seedTask()
    expect(task.version).toBe(1)

    task = addConstraint(
      task,
      { rule: 'Ne pas toucher au schéma', basedOnVersion: 1 },
      'agent',
      ctx(10),
    )
    expect(task.version).toBe(2)

    task = logStep(
      task,
      { action: 'Lu le module', result: 'trois entrées', basedOnVersion: 2 },
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

  it('refuse une écriture fondée sur une version dépassée', () => {
    let task = seedTask()
    task = addConstraint(task, { rule: 'Aucune dépendance', basedOnVersion: 1 }, 'human', ctx(10))
    expect(task.version).toBe(2)

    expect(() =>
      logStep(
        task,
        { action: 'Ajouté une lib', result: 'ok', basedOnVersion: 1 },
        'agent',
        ctx(20),
      ),
    ).toThrow(StaleStateError)
  })

  it('nomme les deux versions dans le message de refus', () => {
    const task = seedTask()
    try {
      logStep(task, { action: 'a', result: 'b', basedOnVersion: 45 }, 'agent', ctx())
      expect.unreachable('l’écriture aurait dû être refusée')
    } catch (error) {
      expect(error).toBeInstanceOf(StaleStateError)
      const message = (error as StaleStateError).message
      expect(message).toContain('STALE STATE')
      expect(message).toContain('v45')
      expect(message).toContain('v1')
      expect(message).toContain('resume_task')
    }
  })

  it('n’oppose jamais de refus à une écriture humaine', () => {
    let task = seedTask()
    task = logStep(task, { action: 'x', result: 'y', basedOnVersion: 1 }, 'agent', ctx(10))
    // L'humain écrit sans version : c'est ce qui périme celle de l'agent.
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

describe('journal d’audit', () => {
  it('journalise un refus sans toucher à la version ni au contenu', () => {
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

  it('enregistre la version avant et après chaque mutation appliquée', () => {
    let task = seedTask()
    task = addConstraint(task, { rule: 'R', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(task.audit.at(-1)).toMatchObject({
      versionBefore: 1,
      versionAfter: 2,
      outcome: 'applied',
    })
  })
})

describe('degrés de preuve', () => {
  it('rétrograde en « claimed » une étape sans preuve', () => {
    let task = seedTask()
    task = logStep(
      task,
      { action: 'a', result: 'b', confidence: 'machine_verified', basedOnVersion: 1 },
      'agent',
      ctx(10),
    )
    expect(task.steps[0].confidence).toBe('claimed')
  })

  it('interdit à un agent de s’attribuer « human_verified »', () => {
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

  it('ne passe en « human_verified » que par la validation humaine', () => {
    let task = seedTask()
    task = logStep(
      task,
      { action: 'a', result: 'b', evidence: { kind: 'diff', content: '+1 -1' }, basedOnVersion: 1 },
      'agent',
      ctx(10),
    )
    const stepId = task.steps[0].id
    task = verifyEvidence(task, stepId, ctx(20))

    expect(task.steps[0].confidence).toBe('human_verified')
    expect(task.steps[0].evidence?.verifiedAt).toBe(1_700_000_000_000)
    expect(evidenceCounts(task).human_verified).toBe(1)
  })

  it('refuse de valider une étape sans preuve', () => {
    let task = seedTask()
    task = logStep(task, { action: 'a', result: 'b', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(() => verifyEvidence(task, task.steps[0].id, ctx(20))).toThrow(ValidationError)
  })
})

describe('cycle de vie', () => {
  it('refuse toute écriture après clôture', () => {
    let task = seedTask()
    task = completeTask(task, { summary: 'Terminé.', basedOnVersion: 1 }, 'agent', ctx(10))
    expect(task.status).toBe('completed')
    expect(task.next).toBeNull()
    expect(() =>
      logStep(task, { action: 'a', result: 'b', basedOnVersion: 2 }, 'agent', ctx(20)),
    ).toThrow(ValidationError)
  })

  it('exige un motif pour tout rejet', () => {
    const task = seedTask()
    expect(() =>
      rejectApproach(task, { approach: 'JWT B', reason: '  ', basedOnVersion: 1 }, 'agent', ctx()),
    ).toThrow(ValidationError)
  })
})

describe('restitution', () => {
  it('rend contraintes actives, rejets et protocole d’écriture', () => {
    let task = seedTask()
    task = addConstraint(
      task,
      { rule: 'Ne jamais modifier le schéma', basedOnVersion: 1 },
      'human',
      ctx(10),
    )
    task = rejectApproach(
      task,
      { approach: 'JWT variante B', reason: 'casse la rotation', basedOnVersion: 2 },
      'agent',
      ctx(20),
    )

    const output = renderTaskState(task)
    expect(output).toContain('Ne jamais modifier le schéma')
    expect(output).toContain('REJECTED — do not retry')
    expect(output).toContain('JWT variante B')
    expect(output).toContain('based_on_version: 3')
  })

  it('omet une contrainte désactivée', () => {
    let task = seedTask()
    task = addConstraint(task, { rule: 'Règle levée', basedOnVersion: 1 }, 'human', ctx(10))
    task = setConstraintActive(task, task.constraints[0].id, false, ctx(20))
    expect(renderTaskState(task)).not.toContain('Règle levée')
  })

  it('reste sous le budget de tokens sur un cahier chargé', () => {
    let task = seedTask()
    for (let i = 0; i < 40; i++) {
      task = logStep(
        task,
        {
          action: `Étape numéro ${i} avec un libellé volontairement long pour peser`,
          result: `Résultat ${i}, lui aussi verbeux, afin de mesurer la dégradation`,
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
        { rule: `Contrainte ${i}`, basedOnVersion: task.version },
        'human',
        ctx(900 + i),
      )
    }

    const output = renderTaskState(task)
    expect(estimateTokens(output)).toBeLessThanOrEqual(TOKEN_BUDGET)
    // Les contraintes ne cèdent jamais la place, même sous contrainte de budget.
    for (let i = 0; i < 6; i++) expect(output).toContain(`Contrainte ${i}`)
  })
})
