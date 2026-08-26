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

/** Entrée qui ne respecte pas le contrat d'un outil. */
export class ValidationError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(`INVALID INPUT\nField "${field}": ${message}`)
    this.name = 'ValidationError'
    this.field = field
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
