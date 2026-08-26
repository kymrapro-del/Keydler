import { describe, expect, it } from 'vitest'
import { ConcurrentWriteError, StaleStateError, ValidationError } from '../src/domain/errors'
import { escapeHtml } from '../src/ui/escape'
import { messageHumain, motifFrancais } from '../src/ui/messages'

/**
 * Ce que lit la personne qui a cliqué.
 *
 * Les messages du domaine sont le contrat de l'agent et restent en anglais. Les
 * montrer bruts à un humain — « Call resume_task before continuing » après un
 * clic sur un bouton — est la faute que ces traductions existent pour éviter.
 */

describe('messages destinés à l’humain', () => {
  it('n’ordonne jamais à une personne d’appeler resume_task', () => {
    const messages = [
      messageHumain(new StaleStateError(5, 6), 'Ajout de la contrainte'),
      messageHumain(new ConcurrentWriteError(5, 6), 'Ajout de la contrainte'),
      messageHumain(new ValidationError('reason', 'must not be empty.'), 'Condamnation'),
    ]
    for (const m of messages) {
      expect(m).not.toContain('resume_task')
      expect(m).not.toContain('STALE STATE')
      expect(m).not.toContain('INVALID INPUT')
    }
  })

  it('explique un conflit entre onglets en disant quoi faire', () => {
    const m = messageHumain(new ConcurrentWriteError(5, 6), 'Ajout de la contrainte')
    expect(m).toContain('un autre onglet')
    expect(m).toContain('version 6')
    expect(m).toContain('refaites votre geste')
  })

  it('nomme l’action qui a échoué', () => {
    // Sans cela, le message reste ambigu quand plusieurs commandes sont à l'écran.
    const m = messageHumain(
      new ValidationError('rule', 'must not be empty.'),
      'Levée de la contrainte',
    )
    expect(m.startsWith('Levée de la contrainte')).toBe(true)
  })

  it('traduit les refus qu’une personne peut réellement déclencher', () => {
    const cas: Array<[ValidationError, string]> = [
      [new ValidationError('reason', 'must not be empty.'), 'le motif ne peut pas être vide.'],
      [
        new ValidationError('rule', 'must be at most 2000 characters.'),
        'la règle dépasse 2000 caractères.',
      ],
      [new ValidationError('approach', 'expected a string.'), "l'approche doit être du texte."],
      [
        new ValidationError('stepId', 'this step carries no evidence to verify.'),
        'cette étape ne porte aucune preuve à valider.',
      ],
      [
        new ValidationError(
          'status',
          'task "X" is already completed; log_step is no longer accepted.',
          false,
        ),
        'cette tâche est close. Rouvrez-la si du travail reste à faire.',
      ],
    ]
    for (const [erreur, attendu] of cas) expect(motifFrancais(erreur)).toBe(attendu)
  })

  it('retombe sur le texte d’origine plutôt que d’inventer une phrase', () => {
    const inconnu = new ValidationError('mystere', 'some brand new rule was broken.')
    // Mieux vaut un message anglais exact qu'une traduction approximative.
    expect(motifFrancais(inconnu)).toBe('some brand new rule was broken.')
  })

  it('nomme un champ inconnu sans planter', () => {
    const m = motifFrancais(new ValidationError('champInedit', 'must not be empty.'))
    expect(m).toContain('« champInedit »')
  })

  it('rend une panne de stockage actionnable', () => {
    const m = messageHumain(new Error('STORAGE UNAVAILABLE\nquota'), 'Ajout')
    expect(m).toContain('navigation privée')
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
