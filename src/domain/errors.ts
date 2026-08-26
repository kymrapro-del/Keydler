/**
 * Erreurs de domaine. Chaque erreur porte le texte exact rendu à l'agent :
 * c'est la seule surface par laquelle le cahier impose une contrainte.
 */

/**
 * Écriture fondée sur une version dépassée. C'est le seul point du système où
 * une règle est réellement imposée, et ce qui permet à l'humain de modifier
 * l'état sans interrompre l'agent.
 */
export class StaleStateError extends Error {
  readonly claimedVersion: number
  readonly currentVersion: number

  constructor(claimedVersion: number, currentVersion: number) {
    super(
      [
        'STALE STATE',
        `You are attempting to log work based on task state v${claimedVersion}.`,
        `Current state is v${currentVersion}. Call resume_task before continuing.`,
      ].join('\n'),
    )
    this.name = 'StaleStateError'
    this.claimedVersion = claimedVersion
    this.currentVersion = currentVersion
  }
}

/**
 * Entrée qui ne respecte pas le contrat d'un outil.
 *
 * `retryable` sépare deux situations que rien d'autre ne distingue : une
 * entrée mal formée, qu'il suffit de corriger et de renvoyer, et un état du
 * cahier qui interdit l'opération — où réessayer ne marchera jamais. Conseiller
 * un réessai dans le second cas inviterait à une boucle infinie.
 */
export class ValidationError extends Error {
  readonly field: string
  readonly retryable: boolean

  constructor(field: string, message: string, retryable = true) {
    super(`INVALID INPUT\nField "${field}": ${message}`)
    this.name = 'ValidationError'
    this.field = field
    this.retryable = retryable
  }
}

/** Tâche absente du magasin — lien périmé ou identifiant inventé. */
export class TaskNotFoundError extends Error {
  readonly taskId: string

  constructor(taskId: string) {
    super(`NO SUCH TASK\nNo task with id "${taskId}" exists on this device.`)
    this.name = 'TaskNotFoundError'
    this.taskId = taskId
  }
}

/**
 * Le cahier a changé sur le disque depuis qu'on l'a lu.
 *
 * Se produit quand une autre page — un second onglet, une autre fenêtre —
 * écrit entre notre lecture et notre écriture. La file d'écriture en mémoire
 * ne peut rien contre ça : elle ne connaît que son propre onglet. Seul le
 * stockage arbitre.
 */
export class ConcurrentWriteError extends Error {
  readonly expectedVersion: number
  readonly foundVersion: number

  constructor(expectedVersion: number, foundVersion: number) {
    super(
      [
        'STALE STATE',
        `You are attempting to write against task state v${expectedVersion}.`,
        `Another page has since written v${foundVersion}. Call resume_task before continuing.`,
      ].join('\n'),
    )
    this.name = 'ConcurrentWriteError'
    this.expectedVersion = expectedVersion
    this.foundVersion = foundVersion
  }
}
