import { buildMeasureTask } from '../demo/measures'
import { buildFullExport, buildTaskExport, exportFilename } from '../export/notebook'
import { parseExport } from '../export/restore'
import { escapeHtml } from './escape'
import { humanMessage } from './messages'
import { describeHistory } from './history'
import { markSeen, seenVersion } from './seen'
import { applyTheme, nextTheme, readTheme, themeLabel } from './theme'
import { buildDemoTask } from '../demo/seed'
import { renderTaskState } from '../domain/render'
import { MIN_QUERY, searchTask, searchTasks, type Match } from '../domain/search'
import {
  acceptedRejections,
  addConstraint,
  answerQuestion,
  answeredQuestions,
  undoLastSupervision,
  undoable,
  attachEvidence,
  openQuestions,
  setArchived,
  editConstraint,
  editRejection,
  logStep,
  renameTask,
  setNext,
  proposedConstraints,
  proposedRejections,
  rejectApproach,
  reopenTask,
  setConstraintActive,
  setConstraintStanding,
  setRejectionStanding,
  verifyEvidence,
} from '../domain/task'
import {
  EVIDENCE_KINDS,
  type Confidence,
  type EvidenceKind,
  type Step,
  type TaskState,
} from '../domain/types'
import { evidenceKindLabel, guessEvidenceKind } from '../domain/evidence'
import * as store from '../store/taskStore'
import {
  addSecret,
  deleteSecret,
  editSecret,
  listSecretNames,
  revealSecret,
  WrongPassphraseError,
} from '../persistence/vault'
import {
  MULTILINE_KINDS,
  SECRET_KINDS,
  secretKindLabel,
  type SecretKind,
  type SecretName,
} from '../domain/secret'
import {
  getRegistrationState,
  getWitness,
  onCall,
  onRegistrationChange,
  resetCalls,
  taskPath,
  taskUrl,
} from '../webmcp'

let root: HTMLElement | null = null

const DEFAULT_DRAFTS: Record<string, string> = {
  'new-title': '',
  'new-next': '',
  'new-rule': '',
  'new-constraint': '',
  'new-rejection': '',
  'new-rejection-reason': '',
  'new-secret-name': '',
  'new-secret-purpose': '',
  'edit-value': '',
  'edit-reason': '',
  'step-action': '',
  'step-result': '',
  'step-evidence': '',
  'step-kind': 'command_output',
  'attach-content': '',
  'attach-kind': 'command_output',
  'answer-text': '',
  'new-secret-kind': 'api_key',
  'edit-secret-kind': 'other',
  search: '',
}

const drafts: Record<string, string> = { ...DEFAULT_DRAFTS }

function resetDrafts(): void {
  for (const key of Object.keys(drafts)) drafts[key] = DEFAULT_DRAFTS[key]
}

let creating = false

let credentials: SecretName[] = []
let revealed: { id: string; value: string } | null = null
let revealTimer: ReturnType<typeof setTimeout> | null = null

export const REVEAL_TTL = 45_000

function hideRevealed(): void {
  revealed = null
  if (revealTimer !== null) {
    clearTimeout(revealTimer)
    revealTimer = null
  }
}

function hideRevealedLater(): void {
  if (revealTimer !== null) clearTimeout(revealTimer)
  revealTimer = setTimeout(() => {
    revealTimer = null
    revealed = null
    renderNow()
  }, REVEAL_TTL)
}
let credentialsFor: string | null = null

let allTasks: TaskState[] = []
let allTasksFor = ''
let notice: string | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const NOTICE_TTL = 8_000

function clearNotice(): void {
  notice = null
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer)
    noticeTimer = null
  }
}

function showNotice(message: string): void {
  notice = message
  if (noticeTimer !== null) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    noticeTimer = null
    notice = null
    renderNow()
  }, NOTICE_TTL)
  scheduleRender()
}
let showAllHistory = false
let awaySince: number | null = null
let awayFor: string | null = null

type Editing =
  | { kind: 'title' }
  | { kind: 'next' }
  | { kind: 'constraint'; id: string }
  | { kind: 'rejection'; id: string }
  | { kind: 'secret'; id: string }

let editing: Editing | null = null
let loggingStep = false
let kindChosen = false
let attachKindChosen = false
let answering: string | null = null
let attaching: string | null = null
let showArchived = false

function renderThemeToggle(): string {
  const choice = readTheme()
  return `<button type="button" id="toggle-theme" class="btn btn--quiet"
            aria-label="${themeLabel(choice)}. Click to switch.">${themeLabel(choice)}</button>`
}

function query(): string {
  return drafts['search'].trim()
}

function searching(): boolean {
  return query().length >= MIN_QUERY
}

function highlight(text: string, q: string): string {
  const needle = q.toLocaleLowerCase()
  if (needle.length === 0) return escapeHtml(text)

  const hay = text.toLocaleLowerCase()
  const parts: string[] = []
  let from = 0

  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    parts.push(escapeHtml(text.slice(from, at)))
    parts.push(`<mark>${escapeHtml(text.slice(at, at + needle.length))}</mark>`)
    from = at + needle.length
  }

  parts.push(escapeHtml(text.slice(from)))
  return parts.join('')
}

function startEditing(next: Editing, value: string, reason = ''): void {
  editing = next
  loggingStep = false
  humanError = null
  drafts['edit-value'] = value
  drafts['edit-reason'] = reason
  renderNow()
  document.querySelector<HTMLInputElement>('#edit-value')?.focus()
}

function stopEditing(): void {
  editing = null
  drafts['edit-value'] = ''
  drafts['edit-reason'] = ''
  renderNow()
}

function chosenEvidenceKind(content: string): EvidenceKind {
  const draft = drafts['step-kind'] as EvidenceKind
  return EVIDENCE_KINDS.includes(draft) ? draft : guessEvidenceKind(content)
}

function resetStepDraft(): void {
  for (const key of ['step-action', 'step-result', 'step-evidence', 'step-kind']) {
    drafts[key] = DEFAULT_DRAFTS[key]
  }
  kindChosen = false
}

function editingIs(kind: Editing['kind'], id?: string): boolean {
  if (!editing || editing.kind !== kind) return false
  return id === undefined || ('id' in editing && editing.id === id)
}

function editForm(label: string, second?: string): string {
  return `<form id="edit-form" class="form form--inline" novalidate>
      <div class="field">
        <label for="edit-value">${label}</label>
        <input id="edit-value" type="text" autocomplete="off" />
      </div>
      ${
        second
          ? `<div class="field">
               <label for="edit-reason">${second}</label>
               <input id="edit-reason" type="text" autocomplete="off" />
             </div>`
          : ''
      }
      <button type="submit" class="btn btn--primary">Save</button>
      <button type="button" id="cancel-edit" class="btn">Cancel</button>
    </form>`
}

function refreshTaskList(key: string): void {
  allTasksFor = key
  void store.allTasks().then(
    (tasks) => {
      allTasks = tasks
      scheduleRender()
    },
    () => {
      allTasks = []
    },
  )
}

function refreshCredentials(taskId: string): void {
  void listSecretNames(taskId).then(
    (names) => {
      credentials = names
      scheduleRender()
    },
    () => {
      credentials = []
    },
  )
}

let humanError: string | null = null

function humanAction(
  action: string,
  mutate: Parameters<typeof store.mutate>[0],
  onSuccess?: () => void,
): void {
  humanError = null
  void store.mutate(mutate).then(
    () => onSuccess?.(),
    (error: unknown) => {
      humanError = humanMessage(error, action)
      scheduleRender()
    },
  )
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  human_verified: 'Verified by you',
  evidence: 'Evidence attached',
  claimed: 'Claimed without evidence',
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function noticeBlock(): string {
  return notice
    ? `<div class="notice notice--ok" role="status"><p>${escapeHtml(notice)}</p></div>`
    : ''
}

function alertBlock(): string {
  return humanError
    ? `<div class="notice notice--error" role="alert"><p>${escapeHtml(humanError)}</p></div>`
    : ''
}

function renderLanding(): string {
  const form = creating
    ? `<form id="create-task" class="form" novalidate>
         <div class="field">
           <label for="new-title">Task title</label>
           <input id="new-title" type="text" autocomplete="off"
                  placeholder="Refactor the authentication module" />
         </div>
         <div class="field">
           <label for="new-next">Next action</label>
           <input id="new-next" type="text" autocomplete="off"
                  placeholder="Map the existing entry points" />
         </div>
         <div class="field">
           <label for="new-rule">First rule <span class="muted">(optional)</span></label>
           <input id="new-rule" type="text" autocomplete="off"
                  placeholder="Never modify the database schema" />
         </div>
         <div class="actions">
           <button type="submit" class="btn btn--primary">Create task</button>
           <button type="button" id="cancel-create" class="btn">Cancel</button>
         </div>
       </form>`
    : `<div class="actions">
         <button type="button" id="start-create" class="btn btn--primary">Create a task</button>
         <button type="button" id="seed" class="btn">Try the demo</button>
       </div>`

  return `<section class="landing">
      <div class="eyebrow-row">
        <p class="landing__eyebrow">Watch Log</p>
        ${renderThemeToggle()}
      </div>
      <h1 class="landing__headline">Give your AI a memory that survives the conversation.</h1>
      <p class="landing__lede">
        The Watch Log keeps completed work, rules to follow, and mistakes not to
        repeat. A new conversation can read it and continue from the right place.
      </p>
      ${alertBlock()}
      ${form}
      <p class="muted landing__note">
        Everything stays in this browser. No account, no server.
      </p>
    </section>`
}

function renderReadyForAI(task: TaskState): string {
  if (task.steps.length > 0) return ''
  return `<section class="card card--guide" aria-labelledby="guide-title">
      <h2 id="guide-title" class="card__title">Ready for your AI</h2>
      <p>Open this page with a WebMCP-enabled agent and say:</p>
      <p class="quote">Continue this task.</p>
      <p class="muted">
        The agent will read this log before working and update it as it progresses.
      </p>
    </section>`
}

function renderNext(task: TaskState): string {
  if (task.status === 'completed') {
    return `<section class="hero hero--done" aria-labelledby="next-title">
        <h2 id="next-title" class="hero__label">Task closed</h2>
        <p class="hero__value">${escapeHtml(task.summary ?? 'No summary was recorded.')}</p>
        <div class="actions">
          <button type="button" id="reopen" class="btn btn--primary">Reopen this task</button>
        </div>
        <p class="muted">Agent writes are refused while it is closed. You stay in charge.</p>
      </section>`
  }

  return `<section class="hero" aria-labelledby="next-title">
      <h2 id="next-title" class="hero__label">Next</h2>
      ${
        editingIs('next')
          ? editForm('What happens next')
          : `<p class="hero__value">${
              task.next
                ? escapeHtml(task.next)
                : '<span class="muted">Not set yet — the agent will decide and record it.</span>'
            }</p>
             <div class="actions">
               <button type="button" id="edit-next" class="btn btn--quiet">Change it</button>
             </div>`
      }
    </section>`
}

const MAX_ROWS = 8

function remainder(total: number): string {
  const hidden = total - MAX_ROWS
  return hidden > 0
    ? `<p class="muted">${hidden} older ${plural(hidden, 'entry', 'entries')} not shown — the export has them all.</p>`
    : ''
}

function renderStepRow(step: Step, active: boolean): string {
  if (attaching === step.id) {
    return `<li class="review">
        <p class="row__text"><strong>${escapeHtml(step.action)}</strong></p>
        <form id="form-attach" class="form" novalidate>
          <div class="field">
            <label for="attach-content">The evidence, pasted whole</label>
            <textarea id="attach-content" rows="5" autocomplete="off" spellcheck="false"
                      placeholder="Command output, a diff, a test report, a link"></textarea>
          </div>
          <div class="field">
            <label for="attach-kind">What that evidence is</label>
            <select id="attach-kind">
              ${EVIDENCE_KINDS.map(
                (kind) => `<option value="${kind}">${escapeHtml(evidenceKindLabel(kind))}</option>`,
              ).join('')}
            </select>
          </div>
          <div class="actions">
            <button type="submit" class="btn btn--primary">Attach it</button>
            <button type="button" id="cancel-attach" class="btn">Cancel</button>
          </div>
          <p class="muted">You read it, so it counts as verified by you.</p>
        </form>
      </li>`
  }

  return `<li class="row">
      <span class="chip chip--${step.confidence}">${CONFIDENCE_LABEL[step.confidence]}</span>
      <span class="row__text">
        <strong>${escapeHtml(step.action)}</strong>
        <span class="muted"> — ${escapeHtml(step.result)}</span>
      </span>
      ${
        active && step.evidence === null
          ? `<button type="button" class="btn btn--quiet" data-attach="${escapeHtml(step.id)}"
                     aria-label="Attach evidence to: ${escapeHtml(step.action)}">Attach evidence</button>`
          : ''
      }
    </li>`
}

function renderCompletedWork(task: TaskState): string {
  const shown = task.steps.slice(-MAX_ROWS).reverse()
  const body = shown.length
    ? `<ul class="rows">${shown
        .map((step) => renderStepRow(step, task.status === 'active'))
        .join('')}</ul>${remainder(task.steps.length)}`
    : `<p class="empty">Nothing recorded yet. Steps appear here as the agent works.</p>`

  const own =
    task.status !== 'active'
      ? ''
      : loggingStep
        ? `<form id="form-step" class="form" novalidate>
             <div class="field">
               <label for="step-action">What you did</label>
               <input id="step-action" type="text" autocomplete="off"
                      placeholder="Rewrote the token issuer by hand" />
             </div>
             <div class="field">
               <label for="step-result">What came of it</label>
               <input id="step-result" type="text" autocomplete="off"
                      placeholder="Public API unchanged, tests still green" />
             </div>
             <div class="field">
               <label for="step-evidence">Evidence <span class="muted">(optional)</span></label>
               <textarea id="step-evidence" rows="5" autocomplete="off" spellcheck="false"
                         placeholder="Paste the command output, a diff, or a link"></textarea>
             </div>
             <div class="field">
               <label for="step-kind">What that evidence is</label>
               <select id="step-kind">
                 ${EVIDENCE_KINDS.map(
                   (kind) =>
                     `<option value="${kind}">${escapeHtml(evidenceKindLabel(kind))}</option>`,
                 ).join('')}
               </select>
             </div>
             <div class="actions">
               <button type="submit" class="btn btn--primary">Record it</button>
               <button type="button" id="cancel-step" class="btn">Cancel</button>
             </div>
             <p class="muted">
               Work you record yourself counts as verified by you — you were there.
             </p>
           </form>`
        : `<div class="actions">
             <button type="button" id="log-step" class="btn btn--quiet">Record a step yourself</button>
           </div>`

  return `<section class="card" aria-labelledby="work-title">
      <h2 id="work-title" class="card__title">Completed work</h2>
      ${body}
      ${own}
    </section>`
}

function renderRules(task: TaskState): string {
  const decided = task.constraints.filter((c) => c.standing !== 'proposed')

  const rows = decided
    .map((c) => {
      const lifted = !c.active || c.standing === 'declined'
      if (editingIs('constraint', c.id)) return `<li>${editForm('Rule')}</li>`
      return `<li class="row${lifted ? ' row--lifted' : ''}">
        <span class="chip chip--${c.source}">${c.source === 'human' ? 'You' : 'Agent'}</span>
        <span class="row__text">${escapeHtml(c.rule)}</span>
        ${
          c.standing === 'declined'
            ? '<span class="muted">declined</span>'
            : `<button type="button" class="btn btn--quiet" data-edit-rule="${escapeHtml(c.id)}"
                 aria-label="Reword the rule: ${escapeHtml(c.rule)}">Reword</button>
           <button type="button" class="btn" data-toggle="${escapeHtml(c.id)}" data-active="${c.active}"
                 aria-label="${c.active ? 'Lift' : 'Restore'} the rule: ${escapeHtml(c.rule)}">
             ${c.active ? 'Lift' : 'Restore'}
           </button>`
        }
      </li>`
    })
    .join('')

  const form =
    task.status === 'active'
      ? `<form id="form-constraint" class="form form--inline" novalidate>
           <div class="field">
             <label for="new-constraint">Add a rule</label>
             <input id="new-constraint" type="text" autocomplete="off"
                    placeholder="Never modify the database schema" />
           </div>
           <button type="submit" class="btn">Add rule</button>
         </form>
         <p class="muted">
           A rule you add is binding at once, and it makes the agent re-read the log.
         </p>`
      : ''

  return `<section class="card" aria-labelledby="rules-title">
      <h2 id="rules-title" class="card__title">Rules to follow</h2>
      ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="empty">No rules yet.</p>'}
      ${form}
    </section>`
}

function renderDontRetry(task: TaskState): string {
  const rows = acceptedRejections(task)
    .map((r) =>
      editingIs('rejection', r.id)
        ? `<li>${editForm('Approach', 'Why it failed')}</li>`
        : `<li class="row row--danger">
        <span class="chip chip--${r.source}">${r.source === 'human' ? 'You' : 'Agent'}</span>
        <span class="row__text">
          <strong>${escapeHtml(r.approach)}</strong>
          <span class="muted"> — ${escapeHtml(r.reason)}</span>
        </span>
        <button type="button" class="btn btn--quiet" data-edit-rejection="${escapeHtml(r.id)}"
                aria-label="Reword: ${escapeHtml(r.approach)}">Reword</button>
      </li>`,
    )
    .join('')

  const form =
    task.status === 'active'
      ? `<form id="form-rejection" class="form" novalidate>
           <div class="field">
             <label for="new-rejection">Approach to rule out</label>
             <input id="new-rejection" type="text" autocomplete="off"
                    placeholder="JWT approach B" />
           </div>
           <div class="field">
             <label for="new-rejection-reason">Why it failed</label>
             <input id="new-rejection-reason" type="text" autocomplete="off" aria-required="true"
                    placeholder="Breaks refresh token rotation under concurrent logins" />
           </div>
           <button type="submit" class="btn">Rule it out</button>
         </form>
         <p class="muted">
           The reason is required. Without it, the next conversation avoids a word
           instead of understanding a problem — and loses the part still worth keeping.
         </p>`
      : ''

  return `<section class="card" aria-labelledby="reject-title">
      <h2 id="reject-title" class="card__title">Don’t retry</h2>
      ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="empty">Nothing ruled out yet.</p>'}
      ${form}
    </section>`
}

function renderSearchBox(): string {
  return `<form class="search" id="form-search" role="search" novalidate>
      <label class="visually-hidden" for="search">Search this task and the others</label>
      <input id="search" type="search" autocomplete="off"
             placeholder="Search rules, work, evidence, other tasks…" />
      ${searching() ? '<button type="button" id="clear-search" class="btn">Clear</button>' : ''}
    </form>`
}

function renderMatch(match: Match, q: string): string {
  return `<li class="row">
      <span class="chip chip--evidence">${escapeHtml(match.label)}</span>
      <span class="row__text">
        <strong>${highlight(match.text, q)}</strong>
        ${match.context ? `<span class="muted"> — ${highlight(match.context, q)}</span>` : ''}
      </span>
    </li>`
}

function renderSearchResults(task: TaskState | null): string {
  const q = query()
  const here = task ? searchTask(task, q) : []
  const elsewhere = searchTasks(allTasks, q).filter((t) => t.id !== task?.id)

  const hereBody = here.length
    ? `<ul class="rows">${here
        .slice(0, 40)
        .map((m) => renderMatch(m, q))
        .join('')}</ul>
       ${here.length > 40 ? `<p class="muted">${here.length - 40} more not shown — narrow the search.</p>` : ''}`
    : '<p class="empty">Nothing in this task.</p>'

  const elsewhereBody = elsewhere.length
    ? `<ul class="rows">${elsewhere
        .map(
          (t) => `<li class="row">
            <span class="chip chip--${t.archived ? 'agent' : t.status === 'completed' ? 'human' : 'evidence'}">${
              t.archived ? 'archived' : t.status === 'completed' ? 'closed' : 'open'
            }</span>
            <span class="row__text">
              <strong>${highlight(t.title, q)}</strong>
              ${t.next ? `<span class="muted"> — ${highlight(t.next, q)}</span>` : ''}
            </span>
            <button type="button" class="btn" data-open="${escapeHtml(t.id)}">Open</button>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">No other task matches.</p>'

  return `<section class="card" aria-labelledby="search-title">
      <h2 id="search-title" class="card__title">
        ${here.length + elsewhere.length} ${plural(here.length + elsewhere.length, 'match', 'matches')} for “${escapeHtml(q)}”
      </h2>
      <h3>In this task <span class="muted">(${here.length})</span></h3>
      ${hereBody}
      <h3>Other tasks <span class="muted">(${elsewhere.length})</span></h3>
      ${elsewhereBody}
    </section>`
}

function renderSwitcher(task: TaskState): string {
  const others = allTasks.filter((t) => t.id !== task.id && (showArchived || !t.archived))
  const hidden = allTasks.filter((t) => t.id !== task.id && t.archived).length
  const rows = others
    .map(
      (t) => `<li class="row">
        <span class="chip chip--${t.archived ? 'agent' : t.status === 'completed' ? 'human' : 'evidence'}">${
          t.archived ? 'archived' : t.status === 'completed' ? 'closed' : 'open'
        }</span>
        <span class="row__text">
          <strong>${escapeHtml(t.title)}</strong>
          <span class="muted"> — ${escapeHtml(t.next ?? 'no next action')}</span>
        </span>
        <button type="button" class="btn btn--quiet" data-archive="${escapeHtml(t.id)}"
                data-archived="${t.archived}">${t.archived ? 'Unarchive' : 'Archive'}</button>
        <button type="button" class="btn" data-open="${escapeHtml(t.id)}">Open</button>
      </li>`,
    )
    .join('')

  return `<details class="switcher">
      <summary>${allTasks.length} ${plural(allTasks.length, 'task', 'tasks')} on this device</summary>
      <div class="switcher__body">
        ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="empty">This is the only one.</p>'}
        <div class="actions">
          <button type="button" id="new-task" class="btn">New task</button>
          <button type="button" id="import" class="btn">Import a file</button>
          <button type="button" id="archive-current" class="btn btn--quiet">${
            task.archived ? 'Bring this task back' : 'Archive this task'
          }</button>
          ${
            hidden > 0
              ? `<button type="button" id="toggle-archived" class="btn btn--quiet">${
                  showArchived ? 'Hide archived' : `Show ${hidden} archived`
                }</button>`
              : ''
          }
          <input id="import-file" type="file" accept=".md,.markdown,.json,text/markdown" hidden />
        </div>
      </div>
    </details>`
}

function renderAway(task: TaskState): string {
  const since = awaySince
  if (since === null || since >= task.version) return ''

  const lines = describeHistory(task.audit.filter((e) => e.versionAfter > since))
  if (lines.length === 0) return ''

  const shown = lines.slice(0, 8)
  const rows = shown
    .map(
      (l) => `<li class="row">
          <span class="chip chip--${l.who === 'You' ? 'human' : 'agent'}">${escapeHtml(l.who)}</span>
          <span class="row__text">
            <strong>${escapeHtml(l.what)}</strong>
            ${l.detail ? `<span class="muted"> — ${escapeHtml(l.detail)}</span>` : ''}
          </span>
        </li>`,
    )
    .join('')

  return `<section class="card card--away" aria-labelledby="away-title">
      <h2 id="away-title" class="card__title">While you were away</h2>
      <p class="muted">
        ${lines.length} ${plural(lines.length, 'write', 'writes')} since you last had this
        page open, at v${since}.
      </p>
      <ul class="rows">${rows}</ul>
      ${
        lines.length > shown.length
          ? `<p class="muted">${lines.length - shown.length} older still, in the history below.</p>`
          : ''
      }
      <div class="actions">
        <button type="button" id="seen" class="btn btn--primary">Got it</button>
      </div>
    </section>`
}

function renderWaiting(task: TaskState): string {
  const open = openQuestions(task)
  const answered = answeredQuestions(task)
  if (open.length === 0 && answered.length === 0) return ''

  const openRows = open
    .map((q) => {
      if (answering === q.id) {
        return `<li class="review">
            <p class="row__text"><strong>${escapeHtml(q.question)}</strong></p>
            <form id="form-answer" class="form" novalidate>
              <div class="field">
                <label for="answer-text">Your answer</label>
                <textarea id="answer-text" rows="3" autocomplete="off"
                          placeholder="Answer in your own words — the next conversation reads this"></textarea>
              </div>
              <div class="actions">
                <button type="submit" class="btn btn--primary">Answer it</button>
                <button type="button" id="cancel-answer" class="btn">Cancel</button>
              </div>
            </form>
          </li>`
      }
      return `<li class="review">
          <div class="row">
            <span class="chip chip--agent">asked by ${q.source === 'human' ? 'you' : 'an agent'}</span>
            <span class="row__text">
              <strong>${escapeHtml(q.question)}</strong>
              <span class="muted"> — ${escapeHtml(q.why)}</span>
            </span>
            ${
              task.status === 'active'
                ? `<button type="button" class="btn btn--primary" data-answer="${escapeHtml(q.id)}"
                           aria-label="Answer: ${escapeHtml(q.question)}">Answer</button>`
                : ''
            }
          </div>
        </li>`
    })
    .join('')

  const answeredRows = answered
    .slice(-3)
    .map(
      (q) => `<li class="row">
          <span class="chip chip--human">answered</span>
          <span class="row__text">
            <strong>${escapeHtml(q.question)}</strong>
            <span class="muted"> — ${escapeHtml(q.answer ?? '')}</span>
          </span>
        </li>`,
    )
    .join('')

  return `<section class="card${open.length > 0 ? ' card--waiting' : ''}" aria-labelledby="waiting-title">
      <h2 id="waiting-title" class="card__title">Waiting on you</h2>
      ${
        open.length > 0
          ? `<p class="muted">
               An agent stopped rather than guess. Every later conversation sees these
               until you answer.
             </p>
             <ul class="rows">${openRows}</ul>`
          : ''
      }
      ${answeredRows ? `<h3>Already answered</h3><ul class="rows">${answeredRows}</ul>` : ''}
    </section>`
}

function renderHandoff(task: TaskState): string {
  const undo = undoable(task)
  const undoButton = undo
    ? `<button type="button" id="undo" class="btn btn--quiet"
               aria-label="Undo: you ${escapeHtml(undo)}">Undo that</button>
       <span class="muted">You ${escapeHtml(undo)}.</span>`
    : ''

  if (task.status !== 'active') {
    return undoButton ? `<p class="handoff">${undoButton}</p>` : ''
  }

  return `<p class="handoff">
      <button type="button" id="copy-handoff" class="btn">Copy the hand-off for your agent</button>
      <span class="muted">Copies this page’s address and “Continue this task.”</span>
      ${undoButton}
    </p>`
}

const KIND_HINTS: Record<SecretKind, { name: string; purpose: string }> = {
  api_key: { name: 'gemini-api-key', purpose: 'Calls the Gemini API from the ingestion script' },
  token: { name: 'github-token', purpose: 'Opens pull requests on the release repository' },
  password: { name: 'smtp-password', purpose: 'Sends the nightly report over SMTP' },
  database_url: { name: 'staging-db-url', purpose: 'Read-only replica used by the migration run' },
  webhook_url: { name: 'slack-webhook', purpose: 'Posts build results to the team channel' },
  private_key: { name: 'deploy-signing-key', purpose: 'Signs the deploy bundle' },
  certificate: { name: 'client-cert', purpose: 'Authenticates to the partner API over mTLS' },
  other: { name: 'shared-secret', purpose: 'What this is for, in one line' },
}

function kindHints(kind: SecretKind): { name: string; purpose: string } {
  return KIND_HINTS[kind]
}

function newSecretKind(): SecretKind {
  const draft = drafts['new-secret-kind'] as SecretKind
  return SECRET_KINDS.includes(draft) ? draft : 'api_key'
}

function editSecretKind(): SecretKind {
  const draft = drafts['edit-secret-kind'] as SecretKind
  return SECRET_KINDS.includes(draft) ? draft : 'other'
}

function renderCredentials(task: TaskState): string {
  const rows = credentials
    .map((secret) => {
      const shown =
        revealed && revealed.id === secret.id
          ? `<pre data-revealed="${escapeHtml(secret.id)}">${escapeHtml(revealed.value)}</pre>
             <p class="muted">Hidden again in under a minute.</p>`
          : ''

      if (editingIs('secret', secret.id)) {
        return `<li class="review">
            <div class="field">
              <label for="edit-secret-kind">What kind of secret</label>
              <select id="edit-secret-kind">
                ${SECRET_KINDS.map(
                  (kind) =>
                    `<option value="${kind}"${kind === editSecretKind() ? ' selected' : ''}>${escapeHtml(
                      secretKindLabel(kind),
                    )}</option>`,
                ).join('')}
              </select>
            </div>
            ${editForm('Name the agent will use', 'What it is for')}
          </li>`
      }

      return `<li class="review">
        <div class="row">
          <span class="chip chip--human">${escapeHtml(secretKindLabel(secret.kind))}</span>
          <span class="row__text">
            <code>\${${escapeHtml(secret.name)}}</code>
            <span class="muted"> — ${escapeHtml(secret.purpose)}</span>
          </span>
          <button type="button" class="btn btn--quiet" data-edit-secret="${escapeHtml(secret.id)}"
                  aria-label="Correct the name or purpose of ${escapeHtml(secret.name)}">Correct</button>
          <button type="button" class="btn" data-reveal="${escapeHtml(secret.id)}"
                  aria-label="Reveal the value of ${escapeHtml(secret.name)}">Reveal</button>
          <button type="button" class="btn btn--danger" data-forget="${escapeHtml(secret.id)}"
                  aria-label="Delete the credential ${escapeHtml(secret.name)}">Delete</button>
        </div>
        ${shown}
      </li>`
    })
    .join('')

  const form =
    task.status === 'active'
      ? `<form id="form-secret" class="form" novalidate autocomplete="off">
           <div class="field">
             <label for="new-secret-kind">What kind of secret</label>
             <select id="new-secret-kind">
               ${SECRET_KINDS.map(
                 (kind) => `<option value="${kind}">${escapeHtml(secretKindLabel(kind))}</option>`,
               ).join('')}
             </select>
           </div>
           <div class="field">
             <label for="new-secret-name">Name the agent will use</label>
             <input id="new-secret-name" type="text" autocomplete="off"
                    placeholder="${escapeHtml(kindHints(newSecretKind()).name)}" />
           </div>
           <div class="field">
             <label for="new-secret-purpose">What it is for</label>
             <input id="new-secret-purpose" type="text" autocomplete="off"
                    placeholder="${escapeHtml(kindHints(newSecretKind()).purpose)}" />
           </div>
           <div class="field">
             <label for="new-secret-value">Value</label>
             ${
               MULTILINE_KINDS.includes(newSecretKind())
                 ? `<textarea id="new-secret-value" rows="5" autocomplete="off" spellcheck="false"
                              placeholder="Paste it whole, every line"></textarea>`
                 : `<input id="new-secret-value" type="password" autocomplete="new-password" spellcheck="false" />`
             }
           </div>
           <div class="field">
             <label for="new-secret-passphrase">Passphrase that seals it</label>
             <input id="new-secret-passphrase" type="password" autocomplete="new-password" spellcheck="false" />
           </div>
           <button type="submit" class="btn">Seal it</button>
         </form>`
      : ''

  return `<section class="card" aria-labelledby="credentials-title">
      <h2 id="credentials-title" class="card__title">Credentials</h2>
      <p class="muted">
        The agent sees the <strong>name</strong> and what it is for, never the value.
        It writes <code>\${name}</code> where the value belongs, and you wire the
        real one. No tool on this page can return a value.
      </p>
      ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="empty">No credentials yet.</p>'}
      ${form}
      <p class="muted">
        Sealed with a passphrase that is never stored, and never written to an
        export. This is not an audited secret manager — and anything you reveal on
        screen can be read by an agent that drives this browser.
      </p>
    </section>`
}

function renderProposals(task: TaskState): string {
  const proposals = [
    ...proposedConstraints(task).map((c) => ({
      id: c.id,
      kind: 'constraint' as const,
      label: 'Rule',
      text: c.rule,
    })),
    ...proposedRejections(task).map((r) => ({
      id: r.id,
      kind: 'rejection' as const,
      label: 'Don’t retry',
      text: `${r.approach} — ${r.reason}`,
    })),
  ]

  if (proposals.length === 0) return ''

  const rows = proposals
    .map(
      (p) => `<li class="row">
        <span class="chip chip--agent">${p.label}</span>
        <span class="row__text">${escapeHtml(p.text)}</span>
        <button type="button" class="btn btn--primary" data-accept="${escapeHtml(p.id)}" data-kind="${p.kind}"
                aria-label="Accept: ${escapeHtml(p.text)}">Accept</button>
        <button type="button" class="btn" data-decline="${escapeHtml(p.id)}" data-kind="${p.kind}"
                aria-label="Decline: ${escapeHtml(p.text)}">Decline</button>
      </li>`,
    )
    .join('')

  return `<section class="card card--proposals" aria-labelledby="proposals-title">
      <h2 id="proposals-title" class="card__title">Agent proposals</h2>
      <p class="muted">
        Written by an agent. They have no effect until you accept them, and a later
        conversation is never shown them as rules.
      </p>
      <ul class="rows">${rows}</ul>
    </section>`
}

function renderEvidence(task: TaskState): string {
  const waiting = task.steps.filter((s) => s.evidence !== null && s.confidence !== 'human_verified')
  if (waiting.length === 0) return ''

  const rows = waiting
    .slice(0, MAX_ROWS)
    .map(
      (s) => `<li class="review">
        <div class="row">
          <span class="chip chip--evidence">${escapeHtml(s.evidence!.kind)}</span>
          <span class="row__text"><strong>${escapeHtml(s.action)}</strong></span>
          <button type="button" class="btn btn--primary" data-verify="${escapeHtml(s.id)}"
                  aria-label="Approve the evidence for: ${escapeHtml(s.action)}">Approve</button>
        </div>
        <pre>${escapeHtml(s.evidence!.content)}</pre>
      </li>`,
    )
    .join('')

  return `<section class="card" aria-labelledby="evidence-title">
      <h2 id="evidence-title" class="card__title">Evidence to review</h2>
      <p class="muted">
        Read it before you approve — your click is what says a human checked this.
        Nothing an agent attaches counts as verified on its own.
      </p>
      <ul class="rows">${rows}</ul>
      ${remainder(waiting.length)}
    </section>`
}

function lastRefusal(task: TaskState): string | null {
  const refused = [...task.audit].reverse().find((e) => e.outcome === 'refused')
  if (!refused) return null

  const applied = [...task.audit].reverse().find((e) => e.outcome === 'applied')
  if (applied && applied.at > refused.at) return null

  const detail = refused.detail.toLowerCase()
  if (detail.includes('stale') || detail.includes('another page')) {
    return 'The task changed while the agent was working. It must read the log again.'
  }
  if (detail.includes('cancelled')) {
    return 'An agent call was cancelled before it wrote anything. Nothing changed.'
  }
  if (detail.includes('mutation-id')) {
    return 'An agent reused a write id for different work. Nothing was written.'
  }
  return `An agent write was refused (${refused.operation}). Nothing changed.`
}

function readBeforeWrite(total: number, blindWrites: number, sawRead: boolean): string {
  if (total === 0) return ''

  if (blindWrites > 0) {
    return `<p class="notice notice--stale" role="status">
        ${blindWrites} ${plural(blindWrites, 'write', 'writes')} arrived
        <strong>without reading this page first</strong>. That agent was working from
        its own memory, not from this log — check what it recorded.
      </p>`
  }

  if (!sawRead) return ''

  return `<p class="muted">
      Every write so far arrived <strong>after reading this page</strong>. Counted
      since this page loaded, from the calls below.
    </p>`
}

function renderActivity(task: TaskState): string {
  const { total, refused, recents, blindWrites, sawRead } = getWitness()
  const alert = lastRefusal(task)

  const rows = [...recents]
    .reverse()
    .slice(0, 6)
    .map(
      (c) => `<li class="${c.refused ? 'call call--refused' : 'call'}">
           <code>${escapeHtml(c.tool)}</code>
           <span>${c.refused ? 'refused' : 'applied'}</span>
           <span class="muted">${new Date(c.at).toLocaleTimeString('en-GB')}</span>
         </li>`,
    )
    .join('')

  return `<section class="card" aria-labelledby="activity-title">
      <h2 id="activity-title" class="card__title">Activity</h2>
      ${alert ? `<div class="notice notice--stale" role="status"><p>${escapeHtml(alert)}</p></div>` : ''}
      <p class="muted">${total} tool ${plural(total, 'call', 'calls')} so far, ${refused} refused.</p>
      ${readBeforeWrite(total, blindWrites, sawRead)}
      ${rows ? `<ul class="calls">${rows}</ul>` : '<p class="empty">No agent has called a tool yet.</p>'}
    </section>`
}

const HISTORY_PREVIEW = 12

function renderHistory(task: TaskState): string {
  const lines = describeHistory(task.audit)
  const shown = showAllHistory ? lines : lines.slice(0, HISTORY_PREVIEW)

  const rows = shown
    .map(
      (line) => `<li class="event${line.refused ? ' event--refused' : ''}">
        <span class="event__when muted">${new Date(line.at).toLocaleString('en-GB')}</span>
        <span class="event__what">
          <strong>${line.who}</strong> ${escapeHtml(line.what)}${
            line.repeated > 1 ? ` <span class="muted">×${line.repeated}</span>` : ''
          }
          ${line.detail ? `<span class="muted"> — ${escapeHtml(line.detail)}</span>` : ''}
        </span>
      </li>`,
    )
    .join('')

  const more =
    lines.length > HISTORY_PREVIEW
      ? `<button type="button" id="toggle-history" class="btn">${
          showAllHistory ? 'Show recent only' : `Show all ${lines.length} entries`
        }</button>`
      : ''

  return `<section class="card" aria-labelledby="history-title">
      <h2 id="history-title" class="card__title">History</h2>
      <p class="muted">
        Everything recorded on this task, newest first — including writes that
        were refused. The oldest entries are dropped once the log gets long.
      </p>
      ${rows ? `<ol class="events">${rows}</ol>` : '<p class="empty">Nothing yet.</p>'}
      ${more}
    </section>`
}

function renderTechnical(task: TaskState | null): string {
  const { phase, availability, toolNames, error, observedTools, lifecycle } = getRegistrationState()

  const surface = availability.supported ? availability.surface : 'none'
  const webmcp =
    phase === 'registered' || phase === 'partial'
      ? `<p><strong>WebMCP active</strong> — ${toolNames.length} ${plural(toolNames.length, 'tool', 'tools')} registered, read from <code>${surface}.modelContext</code>.</p>
         ${error ? `<p>Some tools could not be registered: ${escapeHtml(error)}</p>` : ''}`
      : phase === 'failed'
        ? `<p><strong>Registration failed.</strong> ${escapeHtml(error ?? 'unknown reason')}</p>`
        : !availability.supported && availability.reason === 'insecure-context'
          ? `<p><strong>WebMCP needs a secure context.</strong> Serve this page over HTTPS or from <code>localhost</code>.</p>`
          : `<p><strong>WebMCP is not available in this browser.</strong>
               Open <code>chrome://flags/#enable-webmcp-testing</code>, set it to Enabled,
               restart the browser, then reload this page.</p>`

  return `<details class="technical">
      <summary>Technical details</summary>
      <div class="technical__body">
        ${webmcp}
        <p class="mono">Registered: ${escapeHtml(toolNames.join(' · ')) || '(none)'}</p>
        <p class="mono">Observed through <code>getTools()</code>: ${
          observedTools === null ? '(not read)' : escapeHtml(observedTools.join(' · ')) || '(none)'
        }</p>
        <p class="muted">Lifecycle: <strong>${lifecycle.mode}</strong> — ${escapeHtml(lifecycle.reason)}</p>
        ${
          task
            ? `<p class="mono">Task ID: ${escapeHtml(task.id)} · version ${task.version}</p>
               <h3>What <code>resume_task</code> returns</h3>
               <pre>${escapeHtml(
                 renderTaskState(task, { url: taskUrl(task.id), credentials }),
               )}</pre>`
            : ''
        }
        <div class="actions">
          <button type="button" id="export-one" class="btn">Export this task</button>
          <button type="button" id="export-all" class="btn">Export all tasks</button>
          <button type="button" id="reset-witness" class="btn">Clear the call log</button>
          ${task ? '<button type="button" id="delete" class="btn btn--danger">Delete this task</button>' : ''}
        </div>
      </div>
    </details>`
}

function renderDashboard(task: TaskState): string {
  return `<header class="page-head">
      <div class="eyebrow-row">
        <p class="page-head__eyebrow">Watch Log</p>
        ${renderThemeToggle()}
      </div>
      ${
        editingIs('title')
          ? editForm('Task title')
          : `<div class="page-head__title">
               <h1 tabindex="-1">${escapeHtml(task.title)}</h1>
               <button type="button" id="edit-title" class="btn btn--quiet"
                       aria-label="Rename this task">Rename</button>
             </div>`
      }
      ${renderSwitcher(task)}
      ${renderSearchBox()}
    </header>
    ${noticeBlock()}
    ${alertBlock()}
    ${searching() ? renderSearchResults(task) : ''}
    ${renderHandoff(task)}
    ${searching() ? '' : renderAway(task)}
    ${searching() ? '' : renderNext(task)}
    ${searching() ? '' : renderWaiting(task)}
    ${searching() ? '' : renderReadyForAI(task)}
    ${searching() ? '' : renderCompletedWork(task)}
    ${searching() ? '' : renderRules(task)}
    ${searching() ? '' : renderDontRetry(task)}
    ${searching() ? '' : renderCredentials(task)}
    ${searching() ? '' : renderProposals(task)}
    ${searching() ? '' : renderEvidence(task)}
    ${searching() ? '' : renderActivity(task)}
    ${searching() ? '' : renderHistory(task)}
    ${renderTechnical(task)}`
}

function renderBody(): string {
  const { status, task, error, boundId } = store.getSnapshot()

  if (status === 'loading') return `<p class="muted">Loading…</p>`

  if (status === 'error') {
    return `<div class="notice notice--error" role="alert">
        <p>${escapeHtml(humanMessage(new Error(error ?? ''), 'Opening the task'))}</p>
      </div>${renderTechnical(null)}`
  }

  if (status === 'missing') {
    return `<div class="notice notice--warn" role="alert">
        <p><strong>This task does not exist on this device.</strong></p>
        <p>The address points at <code>${escapeHtml(boundId ?? '')}</code>, which is not here.
           No other task has been opened in its place.</p>
      </div>
      ${renderLanding()}`
  }

  // Le formulaire de création prend toute la place, même quand un cahier est
  // déjà ouvert : sans cela, « New task » ne montrait rien depuis un tableau
  // de bord, le formulaire ne vivant que dans l'écran d'accueil.
  if (creating) return renderLanding()
  return task ? renderDashboard(task) : renderLanding()
}

function bindDrafts(): void {
  for (const id of Object.keys(drafts)) {
    const field = document.querySelector<HTMLInputElement>(`#${id}`)
    if (!field) continue
    field.value = drafts[id]
    field.addEventListener('input', () => {
      drafts[id] = field.value
      if (humanError !== null) {
        humanError = null
        document.querySelector('[role="alert"]')?.remove()
      }
    })
  }
}

function bindCreation(): void {
  document.querySelector('#start-create')?.addEventListener('click', () => {
    creating = true
    renderNow()
    document.querySelector<HTMLInputElement>('#new-title')?.focus()
  })

  document.querySelector('#cancel-create')?.addEventListener('click', () => {
    creating = false
    humanError = null
    renderNow()
    document.querySelector<HTMLButtonElement>('#start-create')?.focus()
  })

  document.querySelector<HTMLFormElement>('#create-task')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const title = drafts['new-title'].trim()
    const next = drafts['new-next'].trim()
    const rule = drafts['new-rule'].trim()

    if (!title) {
      humanError = 'Please give the task a title, so a later conversation knows what it is about.'
      renderNow()
      document.querySelector<HTMLInputElement>('#new-title')?.focus()
      return
    }
    if (!next) {
      humanError = 'Please say what the next action is. It is the first thing an agent reads.'
      renderNow()
      document.querySelector<HTMLInputElement>('#new-next')?.focus()
      return
    }

    humanError = null
    void store
      .createAndOpenTask(title, next)
      .then(() => {
        if (!rule) return undefined
        return store
          .mutate((s) => addConstraint(s, { rule, basedOnVersion: null }, 'human'))
          .then(() => undefined)
      })
      .then(
        () => {
          creating = false
          resetDrafts()
          renderNow()
          document.querySelector<HTMLElement>('.page-head h1')?.focus()
        },
        (error: unknown) => {
          humanError = humanMessage(error, 'Creating the task')
          scheduleRender()
        },
      )
  })

  document.querySelector('#seed')?.addEventListener('click', () => {
    const n = Number(new URLSearchParams(location.search).get('mesure'))
    void store.openPreparedTask(n ? buildMeasureTask(n) : buildDemoTask())
  })
}

function bindSupervision(): void {
  document.querySelector('#edit-title')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) startEditing({ kind: 'title' }, task.title)
  })

  document.querySelector('#edit-next')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) startEditing({ kind: 'next' }, task.next ?? '')
  })

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-edit-rule]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.editRule!
      const rule = store.currentTask()?.constraints.find((c) => c.id === id)
      if (rule) startEditing({ kind: 'constraint', id }, rule.rule)
    })
  }

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-edit-rejection]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.editRejection!
      const rejection = store.currentTask()?.rejected.find((r) => r.id === id)
      if (rejection) startEditing({ kind: 'rejection', id }, rejection.approach, rejection.reason)
    })
  }

  const editKind = document.querySelector<HTMLSelectElement>('#edit-secret-kind')
  if (editKind) {
    editKind.value = editSecretKind()
    for (const event of ['input', 'change']) {
      editKind.addEventListener(event, () => {
        drafts['edit-secret-kind'] = editKind.value
      })
    }
  }

  document.querySelector('#cancel-edit')?.addEventListener('click', stopEditing)

  document.querySelector<HTMLFormElement>('#edit-form')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const current = editing
    if (!current) return
    const value = drafts['edit-value'].trim()
    const reason = drafts['edit-reason'].trim()

    if (current.kind === 'secret') {
      const task = store.currentTask()
      if (!task) return
      humanError = null
      void editSecret(current.id, {
        name: value,
        purpose: reason,
        kind: editSecretKind(),
      }).then(
        () => {
          stopEditing()
          refreshCredentials(task.id)
        },
        (error: unknown) => {
          humanError = humanMessage(error, 'Correcting the credential')
          scheduleRender()
        },
      )
      return
    }

    const mutate: Parameters<typeof store.mutate>[0] =
      current.kind === 'title'
        ? (state) => renameTask(state, value)
        : current.kind === 'next'
          ? (state) => setNext(state, value)
          : current.kind === 'constraint'
            ? (state) => editConstraint(state, current.id, value)
            : (state) => editRejection(state, current.id, { approach: value, reason })

    humanAction('Saving the change', mutate, stopEditing)
  })

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-answer]')) {
    b.addEventListener('click', () => {
      answering = b.dataset.answer!
      attaching = null
      editing = null
      humanError = null
      drafts['answer-text'] = ''
      renderNow()
      document.querySelector<HTMLTextAreaElement>('#answer-text')?.focus()
    })
  }

  document.querySelector('#cancel-answer')?.addEventListener('click', () => {
    answering = null
    drafts['answer-text'] = ''
    renderNow()
  })

  document.querySelector<HTMLFormElement>('#form-answer')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const id = answering
    const answer = drafts['answer-text'].trim()
    if (!id || !answer) return

    humanAction(
      'Answering the question',
      (state) => answerQuestion(state, id, answer),
      () => {
        answering = null
        drafts['answer-text'] = ''
        renderNow()
      },
    )
  })

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-attach]')) {
    b.addEventListener('click', () => {
      attaching = b.dataset.attach!
      answering = null
      editing = null
      loggingStep = false
      humanError = null
      drafts['attach-content'] = ''
      drafts['attach-kind'] = 'command_output'
      attachKindChosen = false
      renderNow()
      document.querySelector<HTMLTextAreaElement>('#attach-content')?.focus()
    })
  }

  document.querySelector('#cancel-attach')?.addEventListener('click', () => {
    attaching = null
    drafts['attach-content'] = ''
    renderNow()
  })

  const attachKind = document.querySelector<HTMLSelectElement>('#attach-kind')
  if (attachKind) {
    attachKind.value = drafts['attach-kind']
    for (const event of ['input', 'change']) {
      attachKind.addEventListener(event, () => {
        attachKindChosen = true
        drafts['attach-kind'] = attachKind.value
      })
    }
    document.querySelector('#attach-content')?.addEventListener('input', () => {
      if (attachKindChosen) return
      const guessed = guessEvidenceKind(drafts['attach-content'])
      drafts['attach-kind'] = guessed
      attachKind.value = guessed
    })
  }

  document.querySelector<HTMLFormElement>('#form-attach')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const stepId = attaching
    const content = drafts['attach-content'].trim()
    if (!stepId || !content) return
    const kind = EVIDENCE_KINDS.includes(drafts['attach-kind'] as EvidenceKind)
      ? (drafts['attach-kind'] as EvidenceKind)
      : guessEvidenceKind(content)

    humanAction(
      'Attaching the evidence',
      (state) =>
        attachEvidence(
          state,
          { stepId, evidence: { kind, content }, basedOnVersion: null },
          'human',
        ),
      () => {
        attaching = null
        drafts['attach-content'] = ''
        drafts['attach-kind'] = 'command_output'
        attachKindChosen = false
        renderNow()
      },
    )
  })

  document.querySelector('#log-step')?.addEventListener('click', () => {
    loggingStep = true
    editing = null
    humanError = null
    renderNow()
    document.querySelector<HTMLInputElement>('#step-action')?.focus()
  })

  document.querySelector('#cancel-step')?.addEventListener('click', () => {
    loggingStep = false
    humanError = null
    resetStepDraft()
    renderNow()
  })

  const kindField = document.querySelector<HTMLSelectElement>('#step-kind')
  if (kindField) {
    kindField.value = drafts['step-kind']
    for (const event of ['input', 'change']) {
      kindField.addEventListener(event, () => {
        kindChosen = true
        drafts['step-kind'] = kindField.value
      })
    }
    document.querySelector('#step-evidence')?.addEventListener('input', () => {
      if (kindChosen) return
      const guessed = guessEvidenceKind(drafts['step-evidence'])
      drafts['step-kind'] = guessed
      kindField.value = guessed
    })
  }

  document.querySelector<HTMLFormElement>('#form-step')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const action = drafts['step-action'].trim()
    const result = drafts['step-result'].trim()
    const content = drafts['step-evidence'].trim()
    const kind = chosenEvidenceKind(content)

    humanAction(
      'Recording the step',
      (state) =>
        logStep(
          state,
          {
            action,
            result,
            evidence: content ? { kind, content } : null,
            basedOnVersion: null,
          },
          'human',
        ),
      () => {
        loggingStep = false
        resetStepDraft()
        renderNow()
      },
    )
  })

  document.querySelector<HTMLFormElement>('#form-constraint')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const rule = drafts['new-constraint'].trim()
    if (!rule) return
    humanAction(
      'Adding the rule',
      (state) => addConstraint(state, { rule, basedOnVersion: null }, 'human'),
      () => {
        drafts['new-constraint'] = ''
      },
    )
  })

  document.querySelector<HTMLFormElement>('#form-rejection')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const approach = drafts['new-rejection'].trim()
    const reason = drafts['new-rejection-reason'].trim()
    humanAction(
      'Ruling out the approach',
      (state) => rejectApproach(state, { approach, reason, basedOnVersion: null }, 'human'),
      () => {
        drafts['new-rejection'] = ''
        drafts['new-rejection-reason'] = ''
      },
    )
  })

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.toggle!
      const active = button.dataset.active === 'true'
      humanAction(active ? 'Lifting the rule' : 'Restoring the rule', (state) =>
        setConstraintActive(state, id, !active),
      )
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-verify]')) {
    button.addEventListener('click', () => {
      const shown = button.closest('li')?.querySelector('pre')?.textContent ?? ''
      humanAction('Approving the evidence', (state) =>
        verifyEvidence(state, button.dataset.verify!, shown),
      )
    })
  }

  const decisions = document.querySelectorAll<HTMLButtonElement>('[data-accept],[data-decline]')
  for (const button of decisions) {
    button.addEventListener('click', () => {
      const accepts = button.dataset.accept !== undefined
      const id = (accepts ? button.dataset.accept : button.dataset.decline)!
      const standing = accepts ? 'accepted' : 'declined'
      humanAction(accepts ? 'Accepting the proposal' : 'Declining the proposal', (state) =>
        button.dataset.kind === 'constraint'
          ? setConstraintStanding(state, id, standing)
          : setRejectionStanding(state, id, standing),
      )
    })
  }

  const searchField = document.querySelector<HTMLInputElement>('#search')
  searchField?.addEventListener('input', () => scheduleRender())
  searchField?.addEventListener('search', () => scheduleRender())
  document.querySelector<HTMLFormElement>('#form-search')?.addEventListener('submit', (e) => {
    e.preventDefault()
    renderNow()
  })
  document.querySelector('#clear-search')?.addEventListener('click', () => {
    drafts['search'] = ''
    renderNow()
    document.querySelector<HTMLInputElement>('#search')?.focus()
  })

  document.querySelector('#archive-current')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    humanAction(task.archived ? 'Bringing the task back' : 'Archiving the task', (state) =>
      setArchived(state, !state.archived),
    )
  })

  document.querySelector('#toggle-archived')?.addEventListener('click', () => {
    showArchived = !showArchived
    renderNow()
  })

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-archive]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.archive!
      const wanted = b.dataset.archived !== 'true'
      humanError = null
      void store
        .updateTask(id, (state) => setArchived(state, wanted))
        .then(
          () => {
            allTasksFor = ''
            scheduleRender()
          },
          (error: unknown) => {
            humanError = humanMessage(error, wanted ? 'Archiving the task' : 'Bringing it back')
            scheduleRender()
          },
        )
    })
  }

  document.querySelector('#new-task')?.addEventListener('click', () => {
    creating = true
    clearNotice()
    humanError = null
    renderNow()
    document.querySelector<HTMLInputElement>('#new-title')?.focus()
  })

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open]')) {
    button.addEventListener('click', () => {
      clearNotice()
      void store.openTask(button.dataset.open!).catch((error: unknown) => {
        humanError = humanMessage(error, 'Opening the task')
        scheduleRender()
      })
    })
  }

  const fileField = document.querySelector<HTMLInputElement>('#import-file')
  document.querySelector('#import')?.addEventListener('click', () => fileField?.click())
  fileField?.addEventListener('change', () => {
    const file = fileField.files?.[0]
    if (!file) return
    humanError = null
    clearNotice()
    void file
      .text()
      .then((text) => store.importTasks(parseExport(text)))
      .then(
        (outcome) => {
          const parts: string[] = []
          if (outcome.imported.length) parts.push(`${outcome.imported.length} imported`)
          if (outcome.copied.length) parts.push(`${outcome.copied.length} added as a copy`)
          if (outcome.skipped.length) parts.push(`${outcome.skipped.length} already here`)
          showNotice(
            `${parts.join(', ')}. Credentials are never in an export, so none were restored.`,
          )
          allTasksFor = ''
          scheduleRender()
        },
        (error: unknown) => {
          humanError = humanMessage(error, 'Importing the file')
          scheduleRender()
        },
      )
      .finally(() => {
        fileField.value = ''
      })
  })

  document.querySelector('#seen')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    markSeen(task.id, task.version)
    awaySince = null
    renderNow()
  })

  document.querySelector('#undo')?.addEventListener('click', () => {
    humanAction('Undoing that', (state) => undoLastSupervision(state))
  })

  document.querySelector('#copy-handoff')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    const text = `${location.origin}${taskPath(task.id)}\n\nContinue this task.`
    humanError = null
    void navigator.clipboard?.writeText(text).then(
      () => {
        showNotice('Copied. Paste it to your agent.')
      },
      () => {
        humanError = 'The browser refused clipboard access. Copy the address from the bar instead.'
        scheduleRender()
      },
    )
  })

  const secretKind = document.querySelector<HTMLSelectElement>('#new-secret-kind')
  if (secretKind) {
    secretKind.value = newSecretKind()
    for (const event of ['input', 'change']) {
      secretKind.addEventListener(event, () => {
        drafts['new-secret-kind'] = secretKind.value
        renderNow()
        document.querySelector<HTMLSelectElement>('#new-secret-kind')?.focus()
      })
    }
  }

  document.querySelector<HTMLFormElement>('#form-secret')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const task = store.currentTask()
    if (!task) return

    const name = drafts['new-secret-name'].trim()
    const purpose = drafts['new-secret-purpose'].trim()
    const valueField = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '#new-secret-value',
    )
    const phraseField = document.querySelector<HTMLInputElement>('#new-secret-passphrase')
    const value = valueField?.value ?? ''
    const passphrase = phraseField?.value ?? ''

    humanError = null
    void addSecret({
      taskId: task.id,
      name,
      purpose,
      kind: newSecretKind(),
      value,
      passphrase,
    }).then(
      () => {
        if (valueField) valueField.value = ''
        if (phraseField) phraseField.value = ''
        drafts['new-secret-name'] = ''
        drafts['new-secret-purpose'] = ''
        drafts['new-secret-kind'] = DEFAULT_DRAFTS['new-secret-kind']
        refreshCredentials(task.id)
      },
      (error: unknown) => {
        humanError = humanMessage(error, 'Sealing the credential')
        scheduleRender()
      },
    )
  })

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-edit-secret]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.editSecret!
      const secret = credentials.find((c) => c.id === id)
      if (!secret) return
      drafts['edit-secret-kind'] = secret.kind
      startEditing({ kind: 'secret', id }, secret.name, secret.purpose)
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reveal]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.reveal!
      if (revealed && revealed.id === id) {
        hideRevealed()
        renderNow()
        return
      }
      const passphrase = window.prompt('Passphrase for this credential?')
      if (!passphrase) return
      humanError = null
      void revealSecret(id, passphrase).then(
        (value) => {
          revealed = { id, value }
          renderNow()
          hideRevealedLater()
        },
        (error: unknown) => {
          hideRevealed()
          humanError =
            error instanceof WrongPassphraseError
              ? 'That passphrase does not open this credential.'
              : humanMessage(error, 'Revealing the credential')
          scheduleRender()
        },
      )
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-forget]')) {
    button.addEventListener('click', () => {
      const task = store.currentTask()
      if (!task) return
      const id = button.dataset.forget!
      const secret = credentials.find((c) => c.id === id)
      if (!window.confirm(`Delete the credential ${secret?.name ?? ''}? This cannot be undone.`)) {
        return
      }
      hideRevealed()
      void deleteSecret(id).then(
        () => refreshCredentials(task.id),
        (error: unknown) => {
          humanError = humanMessage(error, 'Deleting the credential')
          scheduleRender()
        },
      )
    })
  }

  document.querySelector('#reopen')?.addEventListener('click', () => {
    const reason = window.prompt('Why are you reopening this task?')
    if (!reason?.trim()) return
    humanAction('Reopening the task', (state) => reopenTask(state, reason))
  })
}

function bindTechnical(): void {
  document.querySelector('#toggle-history')?.addEventListener('click', () => {
    showAllHistory = !showAllHistory
    renderNow()
    document.querySelector<HTMLButtonElement>('#toggle-history')?.focus()
  })

  document.querySelector('#toggle-theme')?.addEventListener('click', () => {
    applyTheme(nextTheme(readTheme()))
    renderNow()
    document.querySelector<HTMLButtonElement>('#toggle-theme')?.focus()
  })

  document.querySelector('#reset-witness')?.addEventListener('click', () => resetCalls())

  document.querySelector('#export-one')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) download(exportFilename(task), buildTaskExport(task))
  })

  document.querySelector('#export-all')?.addEventListener('click', () => {
    void store.allTasks().then(
      (tasks) => download('watch-logs.md', buildFullExport(tasks)),
      (error: unknown) => {
        humanError = humanMessage(error, 'Exporting the tasks')
        scheduleRender()
      },
    )
  })

  document.querySelector('#delete')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    const sure = window.confirm(
      `Permanently delete “${task.title}” (version ${task.version})?\n\n` +
        'Export it first if you want to keep a copy.',
    )
    if (!sure) return
    humanError = null
    void store.deleteCurrentTask().catch((error: unknown) => {
      humanError = humanMessage(error, 'Deleting the task')
      scheduleRender()
    })
  })
}

function download(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

let lastAnnouncement = ''

function announce(): void {
  const region = document.querySelector('#annonces')
  if (!region) return

  const task = store.getSnapshot().task
  if (!task) return

  const refusal = lastRefusal(task)
  const sentence =
    refusal ?? `${task.steps.length} ${plural(task.steps.length, 'step', 'steps')} recorded.`

  if (sentence === lastAnnouncement) return
  lastAnnouncement = sentence
  region.textContent = sentence
}

function reflectAddress(): void {
  if (typeof history === 'undefined' || typeof history.replaceState !== 'function') return

  const { status, boundId } = store.getSnapshot()

  if (status === 'loading') return

  const wanted = boundId ? taskPath(boundId) : '/'
  if (location.pathname === wanted) return
  try {
    history.replaceState(null, '', `${wanted}${location.search}`)
  } catch {}
}

function render(): void {
  if (!root) return

  const openTask = store.currentTask()

  if (openTask && awayFor !== openTask.id) {
    awayFor = openTask.id
    // La première ouverture d'un cahier n'est pas une absence : on note la
    // version courante sans rien annoncer.
    const known = seenVersion(openTask.id)
    awaySince = known === null ? null : known
    if (known === null) markSeen(openTask.id, openTask.version)
  }

  // On ne marque « vu » que si l'onglet est réellement à l'écran. Un onglet en
  // arrière-plan pendant qu'un agent travaille est exactement l'absence que ce
  // digest doit rapporter.
  if (openTask && awaySince === null && looking()) markSeen(openTask.id, openTask.version)

  const listKey = openTask ? `${openTask.id}:${openTask.version}:${store.tasksRevision()}` : ''
  if (openTask && allTasksFor !== listKey) refreshTaskList(listKey)
  if ((openTask?.id ?? null) !== credentialsFor) {
    credentialsFor = openTask?.id ?? null
    credentials = []
    revealed = null
    if (openTask) refreshCredentials(openTask.id)
  }

  const active = document.activeElement
  const focused = active instanceof HTMLInputElement && active.id in drafts ? active.id : null
  const caret = focused ? (active as HTMLInputElement).selectionStart : null

  const headingFocused = active !== null && active === root.querySelector('.page-head h1')

  // N'importe quel élément identifié, pas seulement les champs : une écriture
  // d'agent redessine la page, et sans cela le focus retombait sur `body`
  // depuis n'importe quel bouton — au clavier, on repart du début de la page.
  const focusedId =
    !focused && active instanceof HTMLElement && active.id && root.contains(active)
      ? active.id
      : null

  root.innerHTML = `<main id="content">${renderBody()}</main>`

  bindDrafts()
  bindCreation()
  bindSupervision()
  bindTechnical()

  if (focused) {
    const field = document.querySelector<HTMLInputElement>(`#${focused}`)
    field?.focus()
    if (caret !== null) field?.setSelectionRange(caret, caret)
  } else if (headingFocused) {
    root.querySelector<HTMLElement>('.page-head h1')?.focus()
  } else if (focusedId) {
    document.getElementById(focusedId)?.focus()
  }

  announce()
  reflectAddress()
}

let renderScheduled = false
let pendingFrame: number | null = null

function scheduleRender(): void {
  if (renderScheduled) return
  renderScheduled = true
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 0)
  pendingFrame = schedule(() => {
    pendingFrame = null
    renderScheduled = false
    render()
  }) as unknown as number
}

function renderNow(): void {
  if (pendingFrame !== null) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pendingFrame)
    else clearTimeout(pendingFrame)
    pendingFrame = null
  }
  renderScheduled = false
  render()
}

function typingSomewhereElse(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function looking(): boolean {
  return typeof document.visibilityState !== 'string' || document.visibilityState === 'visible'
}

function onVisibilityChange(): void {
  if (!looking()) return
  const task = store.currentTask()
  if (task && awaySince === null) {
    const known = seenVersion(task.id)
    if (known !== null && known < task.version) awaySince = known
  }
  scheduleRender()
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey) return

  if (creating) {
    creating = false
    humanError = null
    event.preventDefault()
    renderNow()
    document.querySelector<HTMLButtonElement>('#new-task')?.focus()
    return
  }

  // La recherche masque le tableau de bord : un formulaire resté ouvert
  // dessous est invisible. On ferme ce qui est à l'écran, pas ce qui est en
  // mémoire.
  if (searching()) {
    drafts['search'] = ''
    event.preventDefault()
    renderNow()
    document.querySelector<HTMLInputElement>('#search')?.focus()
    return
  }

  const openForm = editing !== null || loggingStep || answering !== null || attaching !== null
  if (openForm) {
    editing = null
    loggingStep = false
    answering = null
    attaching = null
    humanError = null
    drafts['edit-value'] = ''
    drafts['edit-reason'] = ''
    drafts['answer-text'] = ''
    resetStepDraft()
    drafts['attach-content'] = ''
    event.preventDefault()
    renderNow()
  }
}

function focusSearchOnSlash(event: KeyboardEvent): void {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
  if (typingSomewhereElse(event.target)) return

  const field = document.querySelector<HTMLInputElement>('#search')
  if (!field) return
  event.preventDefault()
  field.focus()
  field.select()
}

export function mount(target: HTMLElement): () => void {
  root = target
  resetDrafts()
  kindChosen = false
  attachKindChosen = false
  creating = false
  humanError = null
  lastAnnouncement = ''
  renderScheduled = false
  credentials = []
  hideRevealed()
  credentialsFor = null
  allTasks = []
  allTasksFor = ''
  clearNotice()
  showAllHistory = false
  awaySince = null
  awayFor = null
  editing = null
  loggingStep = false
  answering = null
  attaching = null
  showArchived = false

  render()
  const subscriptions = [
    onRegistrationChange(scheduleRender),
    onCall(scheduleRender),
    store.subscribe(scheduleRender),
  ]

  document.addEventListener('keydown', focusSearchOnSlash)
  document.addEventListener('keydown', closeOnEscape)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    document.removeEventListener('keydown', focusSearchOnSlash)
    document.removeEventListener('keydown', closeOnEscape)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    hideRevealed()
    clearNotice()
    for (const off of subscriptions) off()
    if (pendingFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pendingFrame)
      else clearTimeout(pendingFrame)
      pendingFrame = null
    }
    renderScheduled = false
    root = null
  }
}

export function __renderNow(): void {
  renderNow()
}
