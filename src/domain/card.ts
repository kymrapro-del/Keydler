import { needsYou, type Need } from './attention'
import type { TaskState, TaskStatus } from './types'

/**
 * What the picker needs to know about a task that is not open. It kept them
 * WHOLE in memory: measured, a 1000 step task weighs 1.5 MB on the heap, a
 * 20,000 step one 29.6. The card is computed from the normalized task, never
 * from the raw record. A second read, faster but distinct, would end up
 * answering something else.
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
