import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/domain/errors'
import { completeTask, createTask, logStep, reopenTask, verifyEvidence } from '../src/domain/task'
import { renderNoTask, renderTaskState } from '../src/domain/render'
import type { TaskState } from '../src/domain/types'

/**
 * Cycle de vie d'une tâche.
 *
 * L'humain est autoritaire : cette autorité ne peut pas s'arrêter à la
 * clôture, sinon une décision d'agent devient irréversible et le rapport de
 * force s'inverse — exactement ce que ce produit existe pour empêcher.
 */

function ctx(seed = 0) {
  let n = seed
  return { now: 1_700_000_000_000, newId: () => `id-${n++}` }
}

function close(): TaskState {
  let t = createTask({ title: 'Refactoriser', next: 'Cartographier' }, ctx())
  t = logStep(
    t,
    {
      action: 'Suite de tests',
      result: '183 passés',
      evidence: { kind: 'test_report', content: '183 passed' },
      basedOnVersion: t.version,
    },
    'agent',
    ctx(10),
  )
  return completeTask(t, { summary: 'Refactorisation terminée.', basedOnVersion: t.version }, 'agent', ctx(20))
}

describe('clôture et réouverture', () => {
  it('prévient l’agent que la tâche est close plutôt que de le laisser échouer', () => {
    const output = renderTaskState(close())
    expect(output).toContain('TASK CLOSED')
    expect(output).toContain('Writes are refused')
    // Le protocole d'écriture n'a plus de sens ici.
    expect(output).not.toContain('WRITE PROTOCOL')
    expect(output).toContain('SUMMARY')
  })

  it('laisse l’humain rouvrir ce que l’agent a clos', () => {
    const closée = close()
    expect(closée.status).toBe('completed')

    const rouverte = reopenTask(closée, 'Le flux de rafraîchissement reste à faire', ctx(30))

    expect(rouverte.status).toBe('active')
    expect(rouverte.next).toBe('Le flux de rafraîchissement reste à faire')
    expect(rouverte.version).toBe(closée.version + 1)
    expect(rouverte.audit.at(-1)).toMatchObject({ operation: 'reopen_task', actor: 'human' })
  })

  it('conserve le résumé final : c’est une trace, pas un mensonge à effacer', () => {
    const closée = close()
    const rouverte = reopenTask(closée, 'Il reste du travail', ctx(30))
    expect(rouverte.summary).toBe('Refactorisation terminée.')
  })

  it('exige un motif de réouverture', () => {
    expect(() => reopenTask(close(), '  ', ctx(30))).toThrow(ValidationError)
  })

  it('refuse de rouvrir une tâche déjà active', () => {
    const active = createTask({ title: 'T' }, ctx())
    expect(() => reopenTask(active, 'motif', ctx(10))).toThrow(ValidationError)
  })

  it('rend de nouveau les écritures possibles après réouverture', () => {
    let t = reopenTask(close(), 'Il reste du travail', ctx(30))
    t = logStep(t, { action: 'Reprise', result: 'ok', basedOnVersion: t.version }, 'agent', ctx(40))
    expect(t.steps).toHaveLength(2)
    expect(renderTaskState(t)).toContain('WRITE PROTOCOL')
  })

  it('laisse valider une preuve même après clôture', () => {
    const closée = close()
    // La vérification humaine reste légitime après coup : elle n'ajoute pas de
    // travail, elle en atteste.
    const vérifiée = verifyEvidence(closée, closée.steps[0].id, ctx(30))
    expect(vérifiée.steps[0].confidence).toBe('human_verified')
  })

  it('dit clairement qu’il n’y a rien à reprendre, sans conseil trompeur', () => {
    const output = renderNoTask()
    expect(output).toContain('NO ACTIVE TASK')
    expect(output).toContain('nothing to resume')
    // L'ancien texte invitait à appeler log_step, qui aurait été refusé.
    expect(output).not.toContain('call\nlog_step')
    expect(output).toContain('call resume_task again')
  })
})
