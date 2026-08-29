import { fold } from './text'
import type { TaskState } from './types'

export const MIN_QUERY = 2

export type MatchKind =
  'rule' | 'rejection' | 'step' | 'decision' | 'evidence' | 'question' | 'approval' | 'history'

export type Match = {
  kind: MatchKind
  label: string
  text: string
  context: string | null
}

export type TaskHit = {
  id: string
  title: string
  next: string | null
  status: TaskState['status']
  archived: boolean
  where: 'title' | 'next'
}

export function matches(haystack: string, query: string): boolean {
  return fold(haystack).includes(fold(query))
}

/**
 * Fold the query once rather than at every comparison. On a loaded task,
 * `matches` folded it tens of thousands of times per keystroke.
 */
function seeker(query: string): (haystack: string) => boolean {
  const needle = fold(query)
  return (haystack) => fold(haystack).includes(needle)
}

type Searchable = Pick<TaskState, 'id' | 'title' | 'next' | 'status' | 'archived'>

export function searchTasks(tasks: readonly Searchable[], query: string): TaskHit[] {
  if (query.trim().length < MIN_QUERY) return []
  const hit = seeker(query.trim())

  return tasks
    .filter((t) => hit(t.title) || (t.next !== null && hit(t.next)))
    .map((t) => ({
      id: t.id,
      title: t.title,
      next: t.next,
      status: t.status,
      archived: t.archived,
      where: hit(t.title) ? ('title' as const) : ('next' as const),
    }))
}

export function searchTask(task: TaskState, query: string): Match[] {
  if (query.trim().length < MIN_QUERY) return []
  const hit = seeker(query.trim())
  const found: Match[] = []

  for (const c of task.constraints) {
    if (hit(c.rule)) {
      found.push({
        kind: 'rule',
        label: c.standing === 'proposed' ? 'Proposed rule' : c.active ? 'Rule' : 'Lifted rule',
        text: c.rule,
        context: c.source === 'human' ? 'added by you' : 'written by an agent',
      })
    }
  }

  for (const r of task.rejected) {
    if (hit(r.approach) || hit(r.reason)) {
      found.push({
        kind: 'rejection',
        label: r.standing === 'accepted' ? 'Ruled out' : `Rejection (${r.standing})`,
        text: r.approach,
        context: r.reason,
      })
    }
  }

  for (const s of task.steps) {
    const inEvidence = s.evidence !== null && hit(s.evidence.content)
    if (hit(s.action) || hit(s.result) || inEvidence) {
      found.push({
        kind: inEvidence && !hit(s.action) && !hit(s.result) ? 'evidence' : 'step',
        label: inEvidence ? 'Step, matched in its evidence' : 'Step',
        text: s.action,
        context: s.result,
      })
    }
  }

  for (const d of task.decisions) {
    if (hit(d.choice) || hit(d.rationale)) {
      found.push({ kind: 'decision', label: 'Decision', text: d.choice, context: d.rationale })
    }
  }

  for (const q of task.questions) {
    const inAnswer = q.answer !== null && hit(q.answer)
    if (!hit(q.question) && !hit(q.why) && !inAnswer) continue
    found.push({
      kind: 'question',
      label: q.answer === null ? 'Question, still open' : 'Question, answered',
      text: q.answer === null ? q.question : `${q.question} : ${q.answer}`,
      context: q.why,
    })
  }

  for (const a of task.approvals) {
    if (!hit(a.action) && !hit(a.why)) continue
    found.push({
      kind: 'approval',
      label: a.decision === null ? 'Approval, still waiting' : `Approval, ${a.decision} by you`,
      text: a.action,
      context: a.why,
    })
  }

  const alreadyShown = new Set(found.map((m) => fold(m.text)))

  for (const entry of task.audit) {
    if (!hit(entry.detail)) continue
    if (entry.outcome !== 'refused' && alreadyShown.has(fold(entry.detail))) continue
    found.push({
      kind: 'history',
      label: entry.outcome === 'refused' ? 'History, refused' : 'History',
      text: entry.detail,
      context: entry.actor === 'human' ? 'you' : 'an agent',
    })
  }

  return found
}
