import { ConcurrentWriteError, StaleStateError, ValidationError } from '../domain/errors'

/**
 * Messages destinés à la personne qui a cliqué.
 *
 * Les messages du domaine sont écrits pour un agent : ils sont en anglais et se
 * terminent par « Call resume_task before continuing ». Quelqu'un qui vient
 * d'appuyer sur un bouton n'appellera jamais resume_task. Lui montrer ce texte
 * brut serait la même faute que laisser NO ACTIVE TASK traîner à l'écran.
 *
 * Le contrat de l'agent ne bouge pas pour autant : c'est l'interface qui
 * traduit, et elle ne traduit que ce qu'une personne peut réellement
 * déclencher.
 */

/** Noms français des champs que l'interface expose. */
const CHAMPS: Record<string, string> = {
  rule: 'la règle',
  approach: "l'approche",
  reason: 'le motif',
  next: 'la prochaine action',
  title: 'le titre',
  summary: 'le résumé',
  stepId: "l'étape",
  constraintId: 'la contrainte',
  status: 'la tâche',
}

/**
 * Traduit le motif d'un refus de validation. Retombe sur le texte d'origine
 * pour un cas non prévu, plutôt que d'inventer une phrase approximative.
 */
export function motifFrancais(error: ValidationError): string {
  const brut = error.message.split('\n').slice(1).join(' ').replace(/^Field "[^"]*": /, '')
  const champ = CHAMPS[error.field] ?? `le champ « ${error.field} »`

  if (brut.startsWith('must not be empty')) return `${champ} ne peut pas être vide.`

  const tropLong = brut.match(/^must be at most (\d+) characters/)
  if (tropLong) return `${champ} dépasse ${tropLong[1]} caractères.`

  if (brut.startsWith('expected a string')) return `${champ} doit être du texte.`
  if (brut.includes('carries no evidence')) return 'cette étape ne porte aucune preuve à valider.'
  if (brut.includes('is already active')) return "cette tâche n'est pas close."
  if (brut.includes('already completed')) {
    return 'cette tâche est close. Rouvrez-la si du travail reste à faire.'
  }
  return brut
}

/** Message complet, nommant l'action qui a échoué. */
export function messageHumain(error: unknown, action: string): string {
  if (error instanceof ConcurrentWriteError) {
    return (
      `${action} : un autre onglet a modifié ce cahier entre-temps. ` +
      `Il vient d'être rechargé à la version ${error.foundVersion} — refaites votre geste.`
    )
  }
  if (error instanceof StaleStateError) {
    return `${action} : le cahier a changé depuis l'affichage. Refaites votre geste.`
  }
  if (error instanceof ValidationError) {
    return `${action} impossible : ${motifFrancais(error)}`
  }
  if (error instanceof Error && error.message.startsWith('NO ACTIVE TASK')) {
    return `${action} impossible : aucun cahier n'est ouvert sur cet appareil.`
  }
  if (error instanceof Error && error.message.startsWith('STORAGE UNAVAILABLE')) {
    return (
      `${action} impossible : le navigateur refuse l'accès au stockage. ` +
      'La navigation privée et le blocage des données de site en sont les causes habituelles.'
    )
  }
  return `${action} impossible : ${error instanceof Error ? error.message : String(error)}`
}
