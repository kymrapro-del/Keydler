import { needsYou, type Need } from './attention'
import type { TaskState, TaskStatus } from './types'

/**
 * Ce que le sélecteur a besoin de savoir d'un cahier fermé. Il les gardait ENTIERS en
 * mémoire : mesuré, un cahier de 1000 étapes pèse 1,5 Mo en tas, un de 20 000 en pèse 29,6.
 * La fiche se calcule à partir du cahier normalisé, jamais de l'enregistrement brut — une
 * seconde lecture, plus rapide mais distincte, finirait par répondre autre chose.
 */
export type TaskCard = {
  id: string
  title: string
  next: string | null
  status: TaskStatus
  archived: boolean
  needs: Need[]
}

export function cardOf(task: TaskState): TaskCard {
  return {
    id: task.id,
    title: task.title,
    next: task.next,
    status: task.status,
    archived: task.archived,
    needs: needsYou(task),
  }
}
