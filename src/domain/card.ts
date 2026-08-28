import { needsYou, type Need } from './attention'
import type { TaskState, TaskStatus } from './types'

/**
 * Ce que le sélecteur de cahiers a besoin de savoir d'un cahier qui n'est pas
 * ouvert : de quoi l'afficher, le chercher, et dire s'il attend quelque chose
 * de l'humain.
 *
 * Le sélecteur gardait les cahiers ENTIERS en mémoire — tout le poste, en
 * permanence, pour une liste déroulante repliée. Mesuré : un cahier de 1000
 * étapes pèse 1,5 Mo en tas, un de 20 000 en pèse 29,6. Trente cahiers
 * ordinaires suffisaient donc à retenir des dizaines de mégaoctets.
 *
 * La fiche est calculée À PARTIR du cahier normalisé, jamais à partir de
 * l'enregistrement brut : une seconde lecture défensive, plus rapide mais
 * distincte, finirait par répondre autre chose que la première. Ce qui est
 * gagné, c'est la mémoire RETENUE ; le coût de lecture, lui, ne bouge pas.
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
