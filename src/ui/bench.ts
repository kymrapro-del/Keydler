import { buildMeasureTask } from '../demo/measures'
import { buildFullExport, buildTaskExport, exportFilename } from '../export/notebook'
import { parseExport } from '../export/restore'
import { escapeHtml } from './escape'
import { humanMessage } from './messages'
import { describeHistory } from './history'
import { buildDemoTask } from '../demo/seed'
import { renderTaskState } from '../domain/render'
import {
  acceptedRejections,
  addConstraint,
  proposedConstraints,
  proposedRejections,
  rejectApproach,
  reopenTask,
  setConstraintActive,
  setConstraintStanding,
  setRejectionStanding,
  verifyEvidence,
} from '../domain/task'
import type { Confidence, Step, TaskState } from '../domain/types'
import * as store from '../store/taskStore'
import {
  addSecret,
  deleteSecret,
  listSecretNames,
  revealSecret,
  WrongPassphraseError,
} from '../persistence/vault'
import type { SecretName } from '../domain/secret'
import {
  getRegistrationState,
  getWitness,
  onCall,
  onRegistrationChange,
  resetCalls,
  taskPath,
} from '../webmcp'

let root: HTMLElement | null = null

const drafts: Record<string, string> = {
  'new-title': '',
  'new-next': '',
  'new-rule': '',
  'new-constraint': '',
  'new-rejection': '',
  'new-rejection-reason': '',
  'new-secret-name': '',
  'new-secret-purpose': '',
}

let creating = false

let credentials: SecretName[] = []
let revealed: { id: string; value: string } | null = null
let credentialsFor: string | null = null

let allTasks: TaskState[] = []
let allTasksFor = -1
let notice: string | null = null
let showAllHistory = false

function refreshTaskList(version: number): void {
  allTasksFor = version
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
      <p class="landing__eyebrow">Watch Log</p>
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
      <p class="hero__value">${
        task.next
          ? escapeHtml(task.next)
          : '<span class="muted">Not set yet — the agent will decide and record it.</span>'
      }</p>
    </section>`
}

const MAX_ROWS = 8

function remainder(total: number): string {
  const hidden = total - MAX_ROWS
  return hidden > 0
    ? `<p class="muted">${hidden} older ${plural(hidden, 'entry', 'entries')} not shown — the export has them all.</p>`
    : ''
}

function renderStepRow(step: Step): string {
  return `<li class="row">
      <span class="chip chip--${step.confidence}">${CONFIDENCE_LABEL[step.confidence]}</span>
      <span class="row__text">
        <strong>${escapeHtml(step.action)}</strong>
        <span class="muted"> — ${escapeHtml(step.result)}</span>
      </span>
    </li>`
}

function renderCompletedWork(task: TaskState): string {
  const shown = task.steps.slice(-MAX_ROWS).reverse()
  const body = shown.length
    ? `<ul class="rows">${shown.map(renderStepRow).join('')}</ul>${remainder(task.steps.length)}`
    : `<p class="empty">Nothing recorded yet. Steps appear here as the agent works.</p>`

  return `<section class="card" aria-labelledby="work-title">
      <h2 id="work-title" class="card__title">Completed work</h2>
      ${body}
    </section>`
}

function renderRules(task: TaskState): string {
  const decided = task.constraints.filter((c) => c.standing !== 'proposed')

  const rows = decided
    .map((c) => {
      const lifted = !c.active || c.standing === 'declined'
      return `<li class="row${lifted ? ' row--lifted' : ''}">
        <span class="chip chip--${c.source}">${c.source === 'human' ? 'You' : 'Agent'}</span>
        <span class="row__text">${escapeHtml(c.rule)}</span>
        ${
          c.standing === 'declined'
            ? '<span class="muted">declined</span>'
            : `<button type="button" class="btn" data-toggle="${escapeHtml(c.id)}" data-active="${c.active}"
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
    .map(
      (r) => `<li class="row row--danger">
        <span class="chip chip--${r.source}">${r.source === 'human' ? 'You' : 'Agent'}</span>
        <span class="row__text">
          <strong>${escapeHtml(r.approach)}</strong>
          <span class="muted"> — ${escapeHtml(r.reason)}</span>
        </span>
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

function renderSwitcher(task: TaskState): string {
  const others = allTasks.filter((t) => t.id !== task.id)
  const rows = others
    .map(
      (t) => `<li class="row">
        <span class="chip chip--${t.status === 'completed' ? 'human' : 'evidence'}">${t.status === 'completed' ? 'closed' : 'open'}</span>
        <span class="row__text">
          <strong>${escapeHtml(t.title)}</strong>
          <span class="muted"> — ${escapeHtml(t.next ?? 'no next action')}</span>
        </span>
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
          <input id="import-file" type="file" accept=".md,.markdown,.json,text/markdown" hidden />
        </div>
      </div>
    </details>`
}

function renderHandoff(task: TaskState): string {
  if (task.status !== 'active') return ''
  return `<p class="handoff">
      <button type="button" id="copy-handoff" class="btn">Copy the hand-off for your agent</button>
      <span class="muted">Copies this page’s address and “Continue this task.”</span>
    </p>`
}

function renderCredentials(task: TaskState): string {
  const rows = credentials
    .map((secret) => {
      const shown =
        revealed && revealed.id === secret.id
          ? `<pre data-revealed="${escapeHtml(secret.id)}">${escapeHtml(revealed.value)}</pre>`
          : ''
      return `<li class="review">
        <div class="row">
          <span class="chip chip--human">sealed</span>
          <span class="row__text">
            <code>\${${escapeHtml(secret.name)}}</code>
            <span class="muted"> — ${escapeHtml(secret.purpose)}</span>
          </span>
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
             <label for="new-secret-name">Name the agent will use</label>
             <input id="new-secret-name" type="text" autocomplete="off" placeholder="gemini-api-key" />
           </div>
           <div class="field">
             <label for="new-secret-purpose">What it is for</label>
             <input id="new-secret-purpose" type="text" autocomplete="off"
                    placeholder="Calls the Gemini API from the ingestion script" />
           </div>
           <div class="field">
             <label for="new-secret-value">Value</label>
             <input id="new-secret-value" type="password" autocomplete="new-password" spellcheck="false" />
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

function renderActivity(task: TaskState): string {
  const { total, refused, recents } = getWitness()
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
               <pre>${escapeHtml(renderTaskState(task))}</pre>`
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
      <p class="page-head__eyebrow">Watch Log</p>
      <h1 tabindex="-1">${escapeHtml(task.title)}</h1>
      ${renderSwitcher(task)}
    </header>
    ${noticeBlock()}
    ${renderHandoff(task)}
    ${alertBlock()}
    ${renderNext(task)}
    ${renderReadyForAI(task)}
    ${renderCompletedWork(task)}
    ${renderRules(task)}
    ${renderDontRetry(task)}
    ${renderCredentials(task)}
    ${renderProposals(task)}
    ${renderEvidence(task)}
    ${renderActivity(task)}
    ${renderHistory(task)}
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
          for (const key of Object.keys(drafts)) drafts[key] = ''
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

  document.querySelector('#new-task')?.addEventListener('click', () => {
    creating = true
    notice = null
    humanError = null
    renderNow()
    document.querySelector<HTMLInputElement>('#new-title')?.focus()
  })

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open]')) {
    button.addEventListener('click', () => {
      notice = null
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
    notice = null
    void file
      .text()
      .then((text) => store.importTasks(parseExport(text)))
      .then(
        (outcome) => {
          const parts: string[] = []
          if (outcome.imported.length) parts.push(`${outcome.imported.length} imported`)
          if (outcome.copied.length) parts.push(`${outcome.copied.length} added as a copy`)
          if (outcome.skipped.length) parts.push(`${outcome.skipped.length} already here`)
          notice = `${parts.join(', ')}. Credentials are never in an export, so none were restored.`
          allTasksFor = -1
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

  document.querySelector('#copy-handoff')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    const text = `${location.origin}${taskPath(task.id)}\n\nContinue this task.`
    humanError = null
    void navigator.clipboard?.writeText(text).then(
      () => {
        notice = 'Copied. Paste it to your agent.'
        scheduleRender()
      },
      () => {
        humanError = 'The browser refused clipboard access. Copy the address from the bar instead.'
        scheduleRender()
      },
    )
  })

  document.querySelector<HTMLFormElement>('#form-secret')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const task = store.currentTask()
    if (!task) return

    const name = drafts['new-secret-name'].trim()
    const purpose = drafts['new-secret-purpose'].trim()
    const valueField = document.querySelector<HTMLInputElement>('#new-secret-value')
    const phraseField = document.querySelector<HTMLInputElement>('#new-secret-passphrase')
    const value = valueField?.value ?? ''
    const passphrase = phraseField?.value ?? ''

    humanError = null
    void addSecret({ taskId: task.id, name, purpose, value, passphrase }).then(
      () => {
        if (valueField) valueField.value = ''
        if (phraseField) phraseField.value = ''
        drafts['new-secret-name'] = ''
        drafts['new-secret-purpose'] = ''
        refreshCredentials(task.id)
      },
      (error: unknown) => {
        humanError = humanMessage(error, 'Sealing the credential')
        scheduleRender()
      },
    )
  })

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reveal]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.reveal!
      if (revealed && revealed.id === id) {
        revealed = null
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
        },
        (error: unknown) => {
          revealed = null
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
      revealed = null
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
  if (openTask && allTasksFor !== openTask.version) refreshTaskList(openTask.version)
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

export function mount(target: HTMLElement): () => void {
  root = target
  for (const key of Object.keys(drafts)) drafts[key] = ''
  creating = false
  humanError = null
  lastAnnouncement = ''
  renderScheduled = false
  credentials = []
  revealed = null
  credentialsFor = null
  allTasks = []
  allTasksFor = -1
  notice = null
  showAllHistory = false

  render()
  const subscriptions = [
    onRegistrationChange(scheduleRender),
    onCall(scheduleRender),
    store.subscribe(scheduleRender),
  ]

  return () => {
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
