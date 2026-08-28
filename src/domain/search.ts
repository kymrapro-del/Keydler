import type { TaskState } from './types'

export const MIN_QUERY = 2

export type MatchKind =
  'rule' | 'rejection' | 'step' | 'decision' | 'evidence' | 'question' | 'history'

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

function normalise(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function matches(haystack: string, query: string): boolean {
  return normalise(haystack).includes(normalise(query))
}

export function searchTasks(tasks: readonly TaskState[], query: string): TaskHit[] {
  if (query.trim().length < MIN_QUERY) return []
  const q = query.trim()

  return tasks
    .filter((t) => matches(t.title, q) || (t.next !== null && matches(t.next, q)))
    .map((t) => ({
      id: t.id,
      title: t.title,
      next: t.next,
      status: t.status,
      archived: t.archived,
      where: matches(t.title, q) ? ('title' as const) : ('next' as const),
    }))
}

export function searchTask(task: TaskState, query: string): Match[] {
  if (query.trim().length < MIN_QUERY) return []
  const q_ = query.trim()
  const found: Match[] = []

  for (const c of task.constraints) {
    if (matches(c.rule, q_)) {
      found.push({
        kind: 'rule',
        label: c.standing === 'proposed' ? 'Proposed rule' : c.active ? 'Rule' : 'Lifted rule',
        text: c.rule,
        context: c.source === 'human' ? 'added by you' : 'written by an agent',
      })
    }
  }

  for (const r of task.rejected) {
    if (matches(r.approach, q_) || matches(r.reason, q_)) {
      found.push({
        kind: 'rejection',
        label: r.standing === 'accepted' ? 'Ruled out' : `Rejection (${r.standing})`,
        text: r.approach,
        context: r.reason,
      })
    }
  }

  for (const s of task.steps) {
    const inEvidence = s.evidence !== null && matches(s.evidence.content, q_)
    if (matches(s.action, q_) || matches(s.result, q_) || inEvidence) {
      found.push({
        kind: inEvidence && !matches(s.action, q_) && !matches(s.result, q_) ? 'evidence' : 'step',
        label: inEvidence ? 'Step, matched in its evidence' : 'Step',
        text: s.action,
        context: s.result,
      })
    }
  }

  for (const d of task.decisions) {
    if (matches(d.choice, q_) || matches(d.rationale, q_)) {
      found.push({ kind: 'decision', label: 'Decision', text: d.choice, context: d.rationale })
    }
  }

  for (const q of task.questions) {
    const inAnswer = q.answer !== null && matches(q.answer, q_)
    if (!matches(q.question, q_) && !matches(q.why, q_) && !inAnswer) continue
    found.push({
      kind: 'question',
      label: q.answer === null ? 'Question, still open' : 'Question, answered',
      text: q.answer === null ? q.question : `${q.question} — ${q.answer}`,
      context: q.why,
    })
  }

  const alreadyShown = new Set(found.map((m) => normalise(m.text)))

  for (const entry of task.audit) {
    if (!matches(entry.detail, q_)) continue
    if (entry.outcome !== 'refused' && alreadyShown.has(normalise(entry.detail))) continue
    found.push({
      kind: 'history',
      label: entry.outcome === 'refused' ? 'History, refused' : 'History',
      text: entry.detail,
      context: entry.actor === 'human' ? 'you' : 'an agent',
    })
  }

  return found
}
