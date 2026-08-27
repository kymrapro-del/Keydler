import { describe, expect, it } from 'vitest'
import {
  ConcurrentWriteError,
  StaleStateError,
  ValidationError,
  type ValidationCode,
} from '../src/domain/errors'
import { escapeHtml } from '../src/ui/escape'
import { humanMessage, humanReason } from '../src/ui/messages'

/**
 * Ce que lit la personne qui a cliqué.
 *
 * Les messages du domaine sont le contrat de l'AGENT : ils se terminent par
 * « Call resume_task before continuing ». Les montrer bruts à un humain après
 * un clic sur un bouton est la faute que ces reformulations existent pour
 * éviter — et le fait que les deux soient en anglais ne les rend pas
 * interchangeables pour autant.
 */

describe('messages destinés à l’humain', () => {
  it('n’ordonne jamais à une personne d’appeler resume_task', () => {
    const messages = [
      humanMessage(new StaleStateError(5, 6), 'Adding the rule'),
      humanMessage(new ConcurrentWriteError(5, 6), 'Adding the rule'),
      humanMessage(
        new ValidationError('reason', 'must not be empty.', { code: 'empty' }),
        'Ruling out the approach',
      ),
    ]
    for (const m of messages) {
      expect(m).not.toContain('resume_task')
      expect(m).not.toContain('STALE STATE')
      expect(m).not.toContain('INVALID INPUT')
    }
  })

  it('explique un conflit entre onglets en disant quoi faire', () => {
    const m = humanMessage(new ConcurrentWriteError(5, 6), 'Adding the rule')
    expect(m).toContain('another tab')
    expect(m).toContain('version 6')
    expect(m).toContain('try again')
  })

  it('nomme l’action qui a échoué', () => {
    // Sans cela, le message reste ambigu quand plusieurs commandes sont à l'écran.
    const m = humanMessage(
      new ValidationError('rule', 'must not be empty.', { code: 'empty' }),
      'Lifting the rule',
    )
    expect(m.startsWith('Lifting the rule')).toBe(true)
  })

  it('reformule les refus qu’une personne peut réellement déclencher', () => {
    const cas: Array<[ValidationError, string]> = [
      [
        new ValidationError('reason', 'must not be empty.', { code: 'empty' }),
        'the reason cannot be empty.',
      ],
      [
        new ValidationError('rule', 'must be at most 2000 characters.', {
          code: 'too-long',
          max: 2000,
        }),
        'the rule is longer than 2000 characters.',
      ],
      [
        new ValidationError('approach', 'expected a string.', { code: 'not-a-string' }),
        'the approach has to be text.',
      ],
      [
        new ValidationError('stepId', 'this step carries no evidence to verify.', {
          code: 'no-evidence',
        }),
        'that step has no evidence to review.',
      ],
      [
        new ValidationError('status', 'task "X" is already completed.', {
          code: 'already-completed',
          retryable: false,
        }),
        'this task is closed. Reopen it if there is work left.',
      ],
    ]
    for (const [erreur, attendu] of cas) expect(humanReason(erreur)).toBe(attendu)
  })

  it('couvre chaque code sans laisser passer le texte de l’agent', () => {
    // Le domaine ne peut plus ajouter un motif sans que la compilation le
    // signale ici : c'est ce que le couplage par chaîne ne garantissait pas.
    const codes: ValidationCode[] = [
      'empty',
      'too-long',
      'not-a-string',
      'bad-enum',
      'bad-version',
      'not-found',
      'no-evidence',
      'already-active',
      'already-completed',
      'out-of-range',
      'bad-mutation-id',
      'mutation-id-reused',
      'mutation-id-collision',
      'content-not-reviewed',
      'not-proposed',
    ]
    for (const code of codes) {
      const m = humanReason(new ValidationError('rule', 'raw agent text', { code, max: 10 }))
      expect(m).not.toContain('raw agent text')
      expect(m.length).toBeGreaterThan(5)
    }
  })

  it('nomme un champ inconnu sans planter', () => {
    const m = humanReason(
      new ValidationError('champInedit', 'must not be empty.', { code: 'empty' }),
    )
    expect(m).toContain('“champInedit”')
  })

  it('rend une panne de stockage actionnable', () => {
    const m = humanMessage(new Error('STORAGE UNAVAILABLE\nquota'), 'Adding')
    expect(m).toContain('Private browsing')
    expect(m).not.toContain('STORAGE UNAVAILABLE')
  })
})

describe('échappement', () => {
  it('neutralise les guillemets, qui sortiraient d’un attribut', () => {
    expect(escapeHtml('x" onload="alert(1)')).toBe('x&quot; onload=&quot;alert(1)')
    expect(escapeHtml("x' onload='alert(1)")).toBe('x&#39; onload=&#39;alert(1)')
  })

  it('neutralise une balise en position de contenu', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('échappe l’esperluette en premier, sans double échappement', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('laisse un texte ordinaire intact', () => {
    expect(escapeHtml('Ne jamais modifier le schéma')).toBe('Ne jamais modifier le schéma')
  })
})
