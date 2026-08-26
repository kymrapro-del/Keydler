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
 * Traduit le motif d'un refus de validation, **par son code**.
 *
 * Une version antérieure reconnaissait chaque refus à son texte anglais. Le
 * couplage était invisible depuis le domaine : reformuler « must not be
 * empty. » laissait tous les tests verts et faisait silencieusement retomber
 * l'écran en anglais devant la personne qui avait cliqué. Sur un code, ajouter
 * un cas au domaine casse la compilation ici.
 */
export function motifFrancais(error: ValidationError): string {
  const champ = CHAMPS[error.field] ?? `le champ « ${error.field} »`

  switch (error.code) {
    case 'empty':
      return `${champ} ne peut pas être vide.`
    case 'too-long':
      return `${champ} dépasse ${error.max ?? 0} caractères.`
    case 'not-a-string':
      return `${champ} doit être du texte.`
    case 'bad-version':
      return `${champ} doit être un numéro de version.`
    case 'out-of-range':
      return `${champ} est hors des bornes acceptées.`
    case 'bad-enum':
      return `${champ} ne fait pas partie des valeurs acceptées.`
    case 'not-found':
      return `${champ} est introuvable — la page a peut-être changé entre-temps.`
    case 'no-evidence':
      return 'cette étape ne porte aucune preuve à valider.'
    case 'already-active':
      return "cette tâche n'est pas close."
    case 'already-completed':
      return 'cette tâche est close. Rouvrez-la si du travail reste à faire.'
    case 'bad-mutation-id':
      return `${champ} doit être un identifiant d'écriture valide.`
    case 'mutation-id-reused':
      return `${champ} a déjà servi à une autre écriture.`
    case 'mutation-id-collision':
      return `${champ} a déjà servi, avec d'autres arguments.`
    case 'content-not-reviewed':
      return 'la preuve affichée ne correspond plus à celle du cahier — relisez-la avant de valider.'
    case 'not-proposed':
      return 'cette proposition a déjà été traitée.'
  }
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
