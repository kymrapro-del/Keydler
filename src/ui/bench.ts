import { buildMeasureTask } from '../demo/measures'
import { buildFullExport, buildTaskExport, exportFilename } from '../export/notebook'
import { escapeHtml } from './escape'
import { humanMessage } from './messages'
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
  getRegistrationState,
  getWitness,
  onCall,
  onRegistrationChange,
  resetCalls,
  taskPath,
} from '../webmcp'

/**
 * Le tableau de bord.
 *
 * Ce fichier a d'abord été un banc d'essai : il montrait le mécanisme — l'état
 * de l'enregistrement WebMCP, le compteur d'appels, la sortie brute de
 * `resume_task`. Utile pour développer, illisible pour qui découvre.
 *
 * L'ordre est maintenant celui d'une personne qui arrive sans rien savoir : ce
 * qu'il y a à faire, ce qui est fait, ce qui est interdit. Le mécanisme n'a pas
 * disparu — il est replié sous « Technical details », où il renseigne sans
 * dominer.
 *
 * Le texte visible est en anglais : c'est le produit. Les commentaires restent
 * en français, comme le reste du dépôt.
 *
 * `mount` prend sa racine en paramètre et rend de quoi se démonter : c'est ce
 * qui permet de l'instancier dans un DOM de test, plusieurs fois, sans état
 * résiduel entre deux cas.
 */

let root: HTMLElement | null = null

/* -------------------------------------------------------------------------- */
/* Saisies en cours                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Saisies en cours, conservées hors du rendu.
 *
 * La page se redessine à chaque écriture d'agent, et c'est précisément ce qui
 * doit arriver pendant qu'un humain tape : sans ce report, l'agent effacerait
 * la contrainte qu'on est en train de rédiger contre lui.
 */
const drafts: Record<string, string> = {
  'new-title': '',
  'new-next': '',
  'new-rule': '',
  'new-constraint': '',
  'new-rejection': '',
  'new-rejection-reason': '',
}

/** Le formulaire de création est-il déployé ? */
let creating = false

/** Dernier échec d'une action humaine, en langage humain. */
let humanError: string | null = null

/** Exécute une action humaine en rendant son échec lisible. */
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

/* -------------------------------------------------------------------------- */
/* Vocabulaire                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Les trois degrés, dits en anglais courant.
 *
 * « evidence » ne veut pas dire vérifié, et le libellé doit le porter : c'est
 * la distinction que tout le produit défend.
 */
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  human_verified: 'Verified by you',
  evidence: 'Evidence attached',
  claimed: 'Claimed without evidence',
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function alertBlock(): string {
  return humanError
    ? `<div class="notice notice--error" role="alert"><p>${escapeHtml(humanError)}</p></div>`
    : ''
}

/* -------------------------------------------------------------------------- */
/* État vide — la première visite                                              */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Guide après création                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Montré tant qu'aucun agent n'a rien consigné.
 *
 * Il disparaît de lui-même dès la première étape : à ce moment, la personne a
 * vu que ça marche, et la place vaut mieux au travail qu'à la consigne.
 */
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

/* -------------------------------------------------------------------------- */
/* 1 — NEXT                                                                    */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 2 — COMPLETED WORK                                                          */
/* -------------------------------------------------------------------------- */

/** Nombre de lignes affichées par liste. L'export les contient toutes. */
const MAX_ROWS = 8

/** Annonce ce qui n'est pas montré, plutôt que de le taire. */
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

/* -------------------------------------------------------------------------- */
/* 3 — RULES TO FOLLOW                                                         */
/* -------------------------------------------------------------------------- */

function renderRules(task: TaskState): string {
  // Seules les règles endossées figurent ici. Une proposition d'agent a sa
  // propre section : les mêler laisserait un agent poser une règle de la
  // maison, ce que la restitution ne fait plus mais que l'écran ferait encore.
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

/* -------------------------------------------------------------------------- */
/* 4 — DON'T RETRY                                                             */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 5 — AGENT PROPOSALS                                                         */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 6 — EVIDENCE TO REVIEW                                                      */
/* -------------------------------------------------------------------------- */

function renderEvidence(task: TaskState): string {
  // Les PLUS ANCIENNES d'abord : le clic humain est le seul chemin vers
  // « verified », et montrer les plus récentes rendait les anciennes
  // inatteignables tant que les nouvelles n'étaient pas traitées.
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

/* -------------------------------------------------------------------------- */
/* 7 — ACTIVITY                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Le dernier refus, dit en langage humain.
 *
 * Le témoin d'appels sait qu'un appel a été refusé, pas pourquoi. Le journal
 * d'audit, lui, porte le motif — et c'est le motif qui décide de la phrase. Un
 * refus pour état périmé n'est pas une panne : c'est la supervision qui
 * fonctionne, et la page doit le dire ainsi.
 */
function lastRefusal(task: TaskState): string | null {
  const refused = [...task.audit].reverse().find((e) => e.outcome === 'refused')
  if (!refused) return null

  // Un refus plus ancien que la dernière écriture appliquée est de l'histoire,
  // pas une alerte : le laisser en place banaliserait la bannière.
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

/* -------------------------------------------------------------------------- */
/* Détails techniques — repliés                                                */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Assemblage                                                                  */
/* -------------------------------------------------------------------------- */

function renderDashboard(task: TaskState): string {
  return `<header class="page-head">
      <p class="page-head__eyebrow">Watch Log</p>
      <h1 tabindex="-1">${escapeHtml(task.title)}</h1>
    </header>
    ${alertBlock()}
    ${renderNext(task)}
    ${renderReadyForAI(task)}
    ${renderCompletedWork(task)}
    ${renderRules(task)}
    ${renderDontRetry(task)}
    ${renderProposals(task)}
    ${renderEvidence(task)}
    ${renderActivity(task)}
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
    // L'adresse nomme un cahier qui n'existe pas. En ouvrir un autre à sa place
    // ferait exactement ce que le lien par adresse existe pour empêcher.
    return `<div class="notice notice--warn" role="alert">
        <p><strong>This task does not exist on this device.</strong></p>
        <p>The address points at <code>${escapeHtml(boundId ?? '')}</code>, which is not here.
           No other task has been opened in its place.</p>
      </div>
      ${renderLanding()}`
  }

  return task ? renderDashboard(task) : renderLanding()
}

/* -------------------------------------------------------------------------- */
/* Câblage                                                                     */
/* -------------------------------------------------------------------------- */

function bindDrafts(): void {
  for (const id of Object.keys(drafts)) {
    const field = document.querySelector<HTMLInputElement>(`#${id}`)
    if (!field) continue
    field.value = drafts[id]
    field.addEventListener('input', () => {
      drafts[id] = field.value
      // Corriger sa saisie efface le reproche. On retire l'alerte du DOM sans
      // redessiner : un rendu complet détruirait le champ en cours de frappe,
      // ce qui interrompt une composition et vide la pile d'annulation.
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

    // Refusé ICI et en langage humain, plutôt que par le navigateur : un
    // « Please fill out this field » natif ne dit pas pourquoi le champ compte.
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
        // Une règle posée à la création est HUMAINE, donc opposable d'emblée :
        // c'est le seul geste de cet écran qui contraint réellement l'agent.
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
    // `?mesure=N` charge la tâche de mesure N au lieu du cahier de
    // démonstration, pour que le protocole de mesure soit rejouable tel quel.
    const n = Number(new URLSearchParams(location.search).get('mesure'))
    void store.openPreparedTask(n ? buildMeasureTask(n) : buildDemoTask())
  })
}

function bindSupervision(): void {
  document.querySelector<HTMLFormElement>('#form-constraint')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const rule = drafts['new-constraint'].trim()
    if (!rule) return
    // Vidé seulement si la mutation passe : sinon une règle refusée pour
    // longueur disparaissait de l'écran, et on ne pouvait plus la raccourcir.
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
    // On laisse le domaine refuser un motif vide plutôt que de l'intercepter
    // ici : une seule règle, un seul endroit où elle est écrite. Un rejet posé
    // par un humain naît `accepted` — il n'a pas à être endossé ensuite.
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
      // Le contenu RELU est repris du bloc affiché juste sous le bouton, et non
      // de l'état : c'est ce qui fait de ce paramètre une attestation.
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

  document.querySelector('#reopen')?.addEventListener('click', () => {
    const reason = window.prompt('Why are you reopening this task?')
    if (!reason?.trim()) return
    humanAction('Reopening the task', (state) => reopenTask(state, reason))
  })
}

function bindTechnical(): void {
  document.querySelector('#reset-witness')?.addEventListener('click', () => resetCalls())

  document.querySelector('#export-one')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) download(exportFilename(task), buildTaskExport(task))
  })

  document.querySelector('#export-all')?.addEventListener('click', () => {
    void store.allTasks().then(
      (tasks) => download('watch-logs.md', buildFullExport(tasks)),
      (error: unknown) => {
        // Sans cette branche, un stockage indisponible ne produisait ni fichier,
        // ni message, et laissait un rejet non géré dans la console.
        humanError = humanMessage(error, 'Exporting the tasks')
        scheduleRender()
      },
    )
  })

  document.querySelector('#delete')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    // Destructif et irréversible : on demande, en nommant ce qui disparaît.
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

/** Remet un fichier à la personne. Rien ne quitte l'appareil. */
function download(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Révoquée au tour suivant : révoquer dans le même tour que le clic peut
  // laisser un téléchargement vide sur certains navigateurs.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/* -------------------------------------------------------------------------- */
/* Annonces et rendu                                                           */
/* -------------------------------------------------------------------------- */

let lastAnnouncement = ''

/**
 * Annonce un changement dans la région persistante.
 *
 * Les attributs `aria-live` posés sur les nœuds du rendu ne produisaient aucune
 * annonce : `render()` remplace tout le sous-arbre, et une région réinsérée est
 * du DOM neuf, pas une mutation. Seule une région qui survit au rendu est
 * suivie par une aide technique.
 */
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

/**
 * Aligne l'adresse de la barre sur le cahier ouvert.
 *
 * `replaceState`, pas `pushState` : ouvrir un cahier n'est pas une navigation
 * qu'on veut pouvoir défaire par la flèche « précédent ». L'adresse est là pour
 * que le cahier soit RETROUVABLE — copiée, elle rouvre cette tâche-là et pas la
 * dernière touchée sur l'appareil.
 */
function reflectAddress(): void {
  if (typeof history === 'undefined' || typeof history.replaceState !== 'function') return

  const { status, boundId } = store.getSnapshot()

  // Tant que le magasin n'a pas tranché, l'adresse est la SOURCE du lien et non
  // son reflet. Écrire ici effaçait `/t/:id` au premier rendu — synchrone, donc
  // AVANT que le point d'entrée n'ait lu le chemin — et la page repartait sur
  // « le dernier cahier touché ».
  if (status === 'loading') return

  const wanted = boundId ? taskPath(boundId) : '/'
  if (location.pathname === wanted) return
  try {
    history.replaceState(null, '', `${wanted}${location.search}`)
  } catch {
    // Une origine opaque refuse l'écriture de l'historique. L'adresse est un
    // confort, pas le lien lui-même : celui-ci vit dans le magasin.
  }
}

function render(): void {
  // Une frame planifiée avant le démontage s'exécute quand même : sans ce
  // garde-fou, elle écrivait dans une racine devenue nulle.
  if (!root) return

  // Le champ de saisie est remplacé par le rendu : on note s'il avait le focus
  // et où était le curseur, pour que l'agent ne coupe pas la parole à l'humain.
  const active = document.activeElement
  const focused = active instanceof HTMLInputElement && active.id in drafts ? active.id : null
  const caret = focused ? (active as HTMLInputElement).selectionStart : null

  // Le titre est un point d'ancrage : on l'y pose après une création, et une
  // écriture d'agent survenue juste après ne doit pas le faire retomber sur
  // `body`. Le rendu remplace le nœud, donc il faut le rétablir explicitement.
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

/**
 * Rendu groupé.
 *
 * Une écriture d'agent notifie deux fois — une par le magasin, une par le
 * témoin d'appels — et la page se redessinerait deux fois de suite. Sans
 * conséquence sur l'état, mais visible à l'œil pendant une rafale, et deux fois
 * plus d'occasions de perdre le curseur de la personne qui tape.
 */
let renderScheduled = false
let pendingFrame: number | null = null

function scheduleRender(): void {
  if (renderScheduled) return
  renderScheduled = true
  // À la frame, pas à la micro-tâche : les deux notifications d'une écriture
  // d'agent sont séparées par un `await`, si bien qu'une micro-tâche ne
  // grouperait rien.
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

/**
 * Rend tout de suite, et ANNULE la frame en attente.
 *
 * Sans cette annulation, un rendu immédiat était suivi, une frame plus tard, du
 * rendu que le magasin avait planifié : tout le sous-arbre était remplacé et le
 * focus que l'appelant venait de poser disparaissait. C'est ce qui se produisait
 * juste après la création d'une tâche — le moment où l'on a le plus besoin d'un
 * point d'ancrage, et où une aide technique n'annonçait plus rien.
 */
function renderNow(): void {
  if (pendingFrame !== null) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pendingFrame)
    else clearTimeout(pendingFrame)
    pendingFrame = null
  }
  renderScheduled = false
  render()
}

/**
 * Monte la vue sur une racine et s'abonne aux trois sources de changement.
 * Rend une fonction de démontage, pour qu'un test puisse repartir à neuf.
 */
export function mount(target: HTMLElement): () => void {
  root = target
  for (const key of Object.keys(drafts)) drafts[key] = ''
  creating = false
  humanError = null
  lastAnnouncement = ''
  renderScheduled = false

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

/** Force un rendu immédiat. Réservé aux tests, qui n'attendent pas la frame. */
export function __renderNow(): void {
  renderNow()
}
