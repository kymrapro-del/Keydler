import { buildMeasureTask } from '../demo/measures'
import { buildFullExport, buildTaskExport, exportFilename } from '../export/notebook'
import { ImportTooLargeError, MAX_IMPORT_BYTES, parseExport } from '../export/restore'
import { linkFor, packTask, readLinkFragment, unpackTask } from '../export/link'
import { escapeHtml } from './escape'
import { humanMessage } from './messages'
import { describeEntry, describeHistory } from './history'
import { historyOf } from '../domain/trail'
import { needsYou, summariseNeeds } from '../domain/attention'
import { sinceThen } from '../domain/elapsed'
import { SHORTCUTS } from './shortcuts'
import { markSeen, seenVersion } from '../persistence/seen'
import {
  askForPersistence,
  describeStorage,
  readStorage,
  UNKNOWN,
  type StorageState,
} from '../persistence/durability'
import { attentionTitle } from './attention'
import { mountTextLoop } from './textLoop'
import { mountSilkBackground } from './silkBackground'
import { mountNavSpy } from './navSpy'
import { buildDemoTask, DEMO_TASK_ID } from '../demo/seed'
import { renderTaskState } from '../domain/render'
import { MIN_QUERY, searchTask, searchTasks, type Match, type MatchKind } from '../domain/search'
import {
  acceptedRejections,
  activeConstraints,
  addConstraint,
  copyRulesInto,
  answerQuestion,
  answeredQuestions,
  decideApproval,
  disputeStep,
  pendingApprovals,
  withdrawDispute,
  undoLastSupervision,
  undoable,
  attachEvidence,
  openQuestions,
  setArchived,
  editConstraint,
  editRejection,
  logStep,
  renameTask,
  setGoal,
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
  type AuditEntry,
  type Confidence,
  type Decision,
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
import { ALL_TOOLS, READ_TOOLS } from '../webmcp/tools'
import {
  getRegistrationState,
  getWitness,
  onCall,
  onRegistrationChange,
  recentlyActive,
  resetCalls,
  taskPath,
  taskUrl,
} from '../webmcp'
import {
  connectProvider,
  disconnectProvider,
  getCloudState,
  loadConnectors,
  onCloudStateChange,
  saveSettings,
  sendMagicLink,
  signOut,
  startCloudSync,
  stopCloudSync,
  syncNow,
  updateCloudState,
  type ConnectorProvider,
} from '../cloud'
import { enabledToolNames, setToolEnabled } from '../security/toolPermissions'
import { refreshToolRegistration } from '../webmcp/register'

let root: HTMLElement | null = null

/**
 * Arrête la boucle d'animation du ruban de texte du rendu précédent.
 *
 * `render()` remplace tout `innerHTML` : sans cet arrêt explicite, le
 * `requestAnimationFrame` du ruban continuerait à tourner sur des nœuds
 * détachés à chaque nouveau rendu, une boucle de plus empilée sur les
 * précédentes · jamais visible à l'œil, jamais libéré non plus.
 */
let stopTextLoop: (() => void) | null = null

/** Même contrat d'arrêt que `stopTextLoop`, pour le fond WebGL landing + workspace. */
let stopSilkBackground: (() => void) | null = null

/** Même contrat d'arrêt, pour la mise en évidence du lien de nav actif. */
let stopNavSpy: (() => void) | null = null

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
  'dispute-reason': '',
  'new-secret-kind': 'api_key',
  'edit-secret-kind': 'other',
  'auth-email': '',
  'connector-key-openai': '',
  'connector-key-anthropic': '',
  'connector-key-gemini': '',
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
let offered: TaskState | null = null
let linkRead = false
let linkPending = false

type Editing =
  | { kind: 'title' }
  | { kind: 'next' }
  | { kind: 'goal' }
  | { kind: 'constraint'; id: string }
  | { kind: 'rejection'; id: string }
  | { kind: 'secret'; id: string }

let editing: Editing | null = null
let loggingStep = false
let kindChosen = false
let attachKindChosen = false
let answering: string | null = null
let attaching: string | null = null
let disputing: string | null = null
let showingShortcuts = false
let showingTrail: string | null = null
let storage: StorageState = UNKNOWN
let storageRead = false
let online = true
let carryRules = false
let searchFilter: MatchKind | 'all' = 'all'
let showArchived = false

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

/**
 * Retour des interactions de maquette.
 *
 * Les futurs parcours cloud sont volontairement cliquables pour éprouver le
 * design, mais ils ne doivent jamais faire croire qu'un compte ou un fournisseur
 * a été connecté. Ce message est donc la seule conséquence de ces boutons.
 */
let previewNotice: string | null = null

/** Le panneau de connexion factice de la landing est-il visible ? */
let previewAuthOpen = false
let connectorEditing: ConnectorProvider | null = null

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

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  human_verified: 'Verified by you',
  evidence: 'Evidence attached',
  claimed: 'Claimed without evidence',
  disputed: 'You say this is wrong',
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function renderAppBar(task: TaskState | null): string {
  const { phase, toolNames } = getRegistrationState()
  const cloud = getCloudState()
  const connection =
    phase === 'registered'
      ? { label: 'WebMCP ready', tone: 'ready' }
      : phase === 'partial'
        ? { label: 'WebMCP partial', tone: 'partial' }
        : phase === 'pending'
          ? { label: 'Checking WebMCP', tone: 'pending' }
          : { label: 'WebMCP off', tone: 'off' }

  return `<header class="top-app-bar">
      <div class="top-app-bar__brand" aria-label="Keydler home">
        <span class="brand-name">Keydler</span>
      </div>
      <div class="top-app-bar__status" aria-label="Application status">
        <span class="status-pill status-pill--${connection.tone}">
          <span class="status-dot" aria-hidden="true"></span>
          ${connection.label}${toolNames.length > 0 ? ` · ${toolNames.length} ${plural(toolNames.length, 'tool', 'tools')}` : ''}
        </span>
        ${task ? `<span class="version-pill">Version ${task.version}</span>` : ''}
        <button type="button" class="profile-preview" data-open-auth aria-label="${cloud.user ? 'Open account and security menu' : 'Sign in'}">
          <span aria-hidden="true">${cloud.user ? escapeHtml(cloud.user.email.slice(0, 1).toLocaleUpperCase()) : '↗'}</span>
        </button>
      </div>
    </header>`
}

function renderCloudAuthPanel(): string {
  if (!previewAuthOpen) return ''
  const cloud = getCloudState()

  if (!cloud.configured) {
    return `<section class="preview-auth account-panel" aria-labelledby="account-title">
        <div><span class="preview-flag">Local-only deployment</span><h2 id="account-title">Cloud accounts are not configured.</h2><p>The workspace remains fully usable on this device. Add the two public Supabase variables to enable real authentication and encrypted sync.</p></div>
        <button type="button" data-close-auth class="btn">Close</button>
      </section>`
  }

  if (cloud.auth === 'loading') {
    return `<section class="preview-auth account-panel" aria-live="polite"><p>Checking the secure session…</p></section>`
  }

  if (cloud.user) {
    return `<section class="preview-auth account-panel" aria-labelledby="account-title">
        <div><span class="preview-flag">Authenticated workspace</span><h2 id="account-title">${escapeHtml(cloud.user.email)}</h2><p>${cloud.workspace ? `${escapeHtml(cloud.workspace.name)} · ${escapeHtml(cloud.workspace.role)}` : 'Loading workspace access…'}</p></div>
        <div class="account-panel__status">
          <span class="status-pill status-pill--ready"><span class="status-dot" aria-hidden="true"></span>Session protected</span>
          <span class="status-pill">${cloud.sync === 'synced' ? 'Cloud synced' : cloud.sync === 'syncing' ? 'Syncing…' : 'Local-only'}</span>
        </div>
        <div class="actions">
          ${cloud.settings.cloudSyncEnabled ? '<button type="button" id="sync-now" class="btn btn--primary">Sync now</button>' : ''}
          <button type="button" id="sign-out" class="btn">Sign out here</button>
          <button type="button" id="sign-out-everywhere" class="btn btn--danger">Sign out everywhere</button>
          <button type="button" data-close-auth class="btn btn--text">Close</button>
        </div>
      </section>`
  }

  return `<form id="cloud-auth" class="preview-auth account-panel" novalidate>
      <div><span class="preview-flag">Passwordless authentication</span><h2 id="account-title">Open your private workspace.</h2><p>We send a single-use sign-in link. The session stays in this browser session and the database enforces access with row-level security.</p></div>
      <div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="you@example.com" /></div>
      <div class="actions"><button type="submit" class="btn btn--primary">Send secure link</button><button type="button" data-close-auth class="btn">Cancel</button></div>
    </form>`
}

function renderPreviewNotice(): string {
  return previewNotice
    ? `<div class="preview-feedback" role="status" data-preview-feedback tabindex="-1">
        <span class="preview-feedback__mark" aria-hidden="true">i</span>
        <p>${escapeHtml(previewNotice)}</p>
        <button type="button" class="btn btn--text" data-dismiss-preview>Dismiss</button>
      </div>`
    : ''
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
  // La pastille de la nav montre le compte RÉEL d'outils enregistrés à cet
  // instant · 0 sans support WebMCP, jusqu'à treize sinon · jamais un chiffre
  // choisi pour faire joli. `onRegistrationChange` est déjà abonné à
  // `scheduleRender` dans `mount()`, donc ce nombre se retrouve à jour tout
  // seul au prochain rendu, sans abonnement supplémentaire ici.
  const toolCount = getRegistrationState().toolNames.length

  const creationForm = creating
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
         ${carryableRules()}
         <div class="actions">
           <button type="submit" class="btn btn--primary">Create task</button>
           <button type="button" id="cancel-create" class="btn">Cancel</button>
         </div>
       </form>`
    : ''

  return `<div class="marketing-site">
      <div class="silk-background" data-silk-background aria-hidden="true"></div>
      <nav class="marketing-nav" aria-label="Public navigation">
        <div class="marketing-nav__pill">
          <a class="marketing-brand" href="#landing-hero"><span class="brand-name">Keydler</span></a>
          <div class="marketing-nav__links" data-nav-links>
            <a href="#how-it-works">How it works</a>
            <a href="#dashboard-tour" aria-label="Dashboard \\\\ ${toolCount} WebMCP ${plural(toolCount, 'tool', 'tools')} registered right now">Dashboard<span class="marketing-nav__badge" aria-hidden="true">${toolCount}</span></a>
            <a href="#free">Free</a>
          </div>
        </div>
        <a
          class="marketing-nav__external"
          href="https://github.com/kymrapro-del/ChatGPT-WebMCP"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the source code on GitHub"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 17 17 7" />
            <path d="M8 7h9v9" />
          </svg>
        </a>
        <button type="button" data-open-auth class="btn btn--tonal marketing-nav__signin">${getCloudState().user ? 'Account' : 'Sign in'}</button>
      </nav>

      ${renderCloudAuthPanel()}

      <section id="landing-hero" class="landing landing--product">
        <div class="landing__copy brand-hero">
          <div class="brand-hero__decor" aria-hidden="true">
            <img class="brand-hero__shape brand-hero__shape--cube" src="/assets/brand/cube.webp" alt="" width="384" height="378" loading="lazy" decoding="async" />
            <img class="brand-hero__shape brand-hero__shape--cylinder" src="/assets/brand/cylinder.webp" alt="" width="384" height="348" loading="lazy" decoding="async" />
            <img class="brand-hero__shape brand-hero__shape--gem" src="/assets/brand/gem.webp" alt="" width="376" height="384" loading="lazy" decoding="async" />
          </div>
          <div class="brand-hero__content">
            <p class="landing__eyebrow">Keydler \\\\ open source memory for WebMCP agents</p>
            <h1 class="landing__headline">Give every AI the context it must <mark class="brand-hero__highlight">not</mark> lose.</h1>
            <p class="landing__lede">
              Keydler keeps decisions, rules, evidence and failed approaches in one supervised
              workspace. A new conversation reads the same memory and continues from the right place.
            </p>
            <div class="actions landing__actions">
              <button type="button" id="start-create" data-start-create class="btn btn--primary">Create a task</button>
              <button type="button" id="seed" class="btn">Try the demo</button>
            </div>
          </div>
        </div>
      </section>

      ${alertBlock()}
      ${creationForm}
      <section id="how-it-works" class="marketing-section" aria-labelledby="how-it-works-title">
        <h2 id="how-it-works-title" class="visually-hidden">How Keydler works</h2>
        <div class="reason-stack">
          <article class="reason-card">
            <img class="reason-card__mascot" src="/assets/brand/mascot.webp" alt="" width="292" height="309" loading="lazy" decoding="async" />
            <div class="reason-card__text">
              <h3>The human sets the memory</h3>
              <p>Rules, rejected approaches and verified evidence stay visible and editable.</p>
            </div>
            <img class="reason-card__icon" src="/assets/brand/controls.webp" alt="" width="571" height="375" loading="lazy" decoding="async" />
          </article>
          <article class="reason-card">
            <div class="reason-card__text">
              <h3>The agent reads typed tools</h3>
              <p>WebMCP exposes compact operations instead of asking a model to guess the interface.</p>
            </div>
            <img class="reason-card__icon" src="/assets/brand/puzzle.webp" alt="" width="513" height="298" loading="lazy" decoding="async" />
          </article>
          <article class="reason-card">
            <div class="reason-card__text">
              <h3>Every write stays supervised</h3>
              <p>Stale writes are refused, retries do not duplicate, and the audit remains readable.</p>
            </div>
            <img class="reason-card__icon" src="/assets/brand/ledger.webp" alt="" width="495" height="337" loading="lazy" decoding="async" />
          </article>
        </div>
      </section>

      <section id="tool-anatomy" class="marketing-section brand-hero" aria-labelledby="anatomy-title">
        <div class="brand-hero__decor" aria-hidden="true">
          <img class="brand-hero__shape brand-hero__shape--cylinder" src="/assets/brand/cylinder.webp" alt="" width="384" height="348" loading="lazy" decoding="async" />
        </div>
        <div class="brand-hero__content">
          <p class="section-heading__eyebrow">Under the hood</p>
          <h2 id="anatomy-title">One WebMCP call, five parts a browser understands.</h2>
          <p class="anatomy-intro">
            Every action an agent can take on this page is registered the same way: a
            <strong>name</strong> to call, a <strong>description</strong> telling the agent when to
            reach for it, an <strong>inputSchema</strong> for its arguments, the
            <strong>execute</strong> function that runs, and <strong>annotations</strong> such as
            <code>readOnlyHint</code> that describe it before it ever runs.
          </p>
        </div>
      </section>

      <div class="text-loop" data-text-loop aria-hidden="true"></div>

      <section id="dashboard-tour" class="marketing-section brand-hero" aria-labelledby="tour-title">
        <div class="brand-hero__decor" aria-hidden="true">
          <img class="brand-hero__shape brand-hero__shape--gem" src="/assets/brand/gem.webp" alt="" width="376" height="384" loading="lazy" decoding="async" />
        </div>
        <div class="brand-hero__content">
          <header class="prototype-heading">
            <div><p class="section-heading__eyebrow">Inside the workspace</p><h2 id="tour-title">Everything you need to supervise AI memory.</h2></div>
            <button type="button" id="seed-tour" class="btn btn--primary">Open interactive dashboard</button>
          </header>
          <div class="tour-grid">
            <article class="tour-card tour-card--wide"><span>Overview</span><h3>See what is active, verified and waiting.</h3><p>One operational view of memories, rules and the next action.</p><div class="tour-bars"><i></i><i></i><i></i></div></article>
            <article class="tour-card"><span>Connections</span><h3>One memory layer for compatible agents.</h3><p>ChatGPT, Claude and Gemini setup flows are presented without inventing provider access.</p></article>
            <article class="tour-card"><span>Live console</span><h3>Watch tools register and run.</h3><p>Inspect calls, refusals, versions and the exact state returned to the agent.</p></article>
            <article class="tour-card tour-card--wide"><span>Configuration</span><h3>Control storage, permissions and retention.</h3><p>Local controls work immediately. Private sync and shared settings activate after secure sign-in.</p><div class="tour-toggles"><i></i><i></i><i></i></div></article>
          </div>
        </div>
      </section>

      <section id="free" class="marketing-section free-section brand-hero" aria-labelledby="free-title">
        <div class="free-section__decor" aria-hidden="true">
          <span class="free-section__symbol free-section__symbol--dollar">$</span>
          <span class="free-section__symbol free-section__symbol--euro">€</span>
        </div>
        <div class="brand-hero__content">
          <h2 id="free-title">Free by design</h2>
          <p class="free-section__callout">0 means 0. No hidden cost.</p>
          <p>The complete local workspace ships under the MIT license. Optional private sync uses your own Supabase project; connected model providers may charge for their API usage.</p>
        </div>
      </section>

      <footer class="marketing-footer">
        <div class="marketing-footer__glow" aria-hidden="true"></div>
        <div class="marketing-footer__top">
          <nav class="marketing-footer__nav" aria-label="Product">
            <p class="marketing-footer__heading">Product</p>
            <ul class="marketing-footer__links">
              <li><a class="marketing-footer__link" href="#how-it-works">How it works</a></li>
              <li><a class="marketing-footer__link" href="#dashboard-tour">Dashboard</a></li>
              <li><a class="marketing-footer__link" href="#free">Free</a></li>
            </ul>
          </nav>
          <nav class="marketing-footer__nav" aria-label="Workspace">
            <p class="marketing-footer__heading">Workspace</p>
            <ul class="marketing-footer__links">
              <li><button type="button" class="marketing-footer__link" data-start-create>Create a task</button></li>
              <li><button type="button" class="marketing-footer__link" id="seed-footer">Try the demo</button></li>
              <li><button type="button" class="marketing-footer__link" data-open-auth>${getCloudState().user ? 'Account' : 'Sign in'}</button></li>
            </ul>
          </nav>
          <nav class="marketing-footer__nav" aria-label="Source">
            <p class="marketing-footer__heading">Source</p>
            <ul class="marketing-footer__links">
              <li>
                <a
                  class="marketing-footer__link"
                  href="https://github.com/kymrapro-del/ChatGPT-WebMCP"
                  target="_blank"
                  rel="noopener noreferrer"
                  >GitHub</a
                >
              </li>
              <li><a class="marketing-footer__link" href="#free">MIT license</a></li>
              <li><a class="marketing-footer__link" href="/licenses/NOTICE.txt">Credits</a></li>
              <li><a class="marketing-footer__link" href="#tool-anatomy">WebMCP tools</a></li>
            </ul>
          </nav>
          <div class="marketing-footer__note">
            <p class="marketing-footer__heading">Standing order</p>
            <p class="marketing-footer__lede">A standing instruction on this page, so the next conversation starts from the right place.</p>
            <div class="marketing-footer__cta">
              <p class="marketing-footer__cta-copy">Free · open source · local-first</p>
              <button type="button" class="marketing-footer__submit" data-start-create>Create a task</button>
            </div>
          </div>
        </div>
        <div class="marketing-footer__bar">
          <p>© Keydler 2026</p>
          <div class="marketing-footer__social" aria-label="Source code">
            <a
              class="marketing-footer__link"
              href="https://github.com/kymrapro-del/ChatGPT-WebMCP"
              target="_blank"
              rel="noopener noreferrer"
              >GitHub</a
            >
          </div>
          <p class="marketing-footer__place">MIT \\\\ WebMCP Challenge</p>
          <p class="marketing-footer__credits">
            Google Fonts · Material Design 3 · Google Icons
          </p>
          <p class="marketing-footer__credits marketing-footer__credits--models">
            Claude Opus 5 &amp; Sonnet 5 · GPT-5.6 Sol · Cursor Grok 4.6 Extra High Fast · GPT-5.6 Luna
          </p>
        </div>
        <p class="marketing-footer__wordmark" aria-hidden="true">Keydler</p>
      </footer>
    </div>`
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

function renderGoal(task: TaskState): string {
  if (editingIs('goal')) return editForm('What done looks like')

  return `<p class="hero__goal">
      <strong>Done when:</strong>
      ${
        task.goal
          ? escapeHtml(task.goal)
          : '<span class="muted">nobody has said yet · an agent reads the next action but not the destination.</span>'
      }
      <button type="button" id="edit-goal" class="btn btn--quiet">
        ${task.goal ? 'Change what done means' : 'Say what done means'}
      </button>
    </p>`
}

function renderNext(task: TaskState): string {
  if (task.status === 'completed') {
    return `<section class="hero hero--done" aria-labelledby="next-title">
        <h2 id="next-title" class="hero__label">Task closed</h2>
        <p class="hero__value">${escapeHtml(task.summary ?? 'No summary was recorded.')}</p>
        ${
          task.goal
            ? `<p class="hero__goal"><strong>Done when:</strong> ${escapeHtml(task.goal)}</p>`
            : ''
        }
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
                : '<span class="muted">Not set yet · the agent will decide and record it.</span>'
            }</p>
             <div class="actions">
               <button type="button" id="edit-next" class="btn btn--quiet">Change it</button>
             </div>`
      }
      ${renderGoal(task)}
    </section>`
}

const MAX_ROWS = 8

function remainder(total: number): string {
  const hidden = total - MAX_ROWS
  return hidden > 0
    ? `<p class="muted">${hidden} older ${plural(hidden, 'entry', 'entries')} not shown · the export has them all.</p>`
    : ''
}

function disputeForm(step: Step): string {
  return `<p class="row__text"><strong>${escapeHtml(step.action)}</strong></p>
      <form id="form-dispute" class="form" novalidate>
        <div class="field">
          <label for="dispute-reason">Why this is wrong</label>
          <textarea id="dispute-reason" rows="3" autocomplete="off"
                    placeholder="What actually happened · every later conversation reads this"></textarea>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn--danger">Mark it wrong</button>
          <button type="button" id="cancel-dispute" class="btn">Cancel</button>
        </div>
      </form>`
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

  if (disputing === step.id) return `<li class="review">${disputeForm(step)}</li>`

  const evidence = step.evidence
    ? `<details class="evidence-disclosure" data-step-evidence="${escapeHtml(step.id)}">
         <summary>View evidence · ${escapeHtml(step.evidence.kind.replaceAll('_', ' '))}</summary>
         <div class="evidence-disclosure__body">
           <pre>${escapeHtml(step.evidence.content)}</pre>
           <p class="supporting-text">${
             step.evidence.verifiedAt === null
               ? 'Attached by its author · not yet checked by a human'
               : 'Checked by a human'
           }</p>
         </div>
       </details>`
    : '<p class="supporting-text step-row__empty">No evidence attached.</p>'

  return `<li class="step-row">
      <div class="row row--step">
        <span class="chip chip--${step.confidence}">${CONFIDENCE_LABEL[step.confidence]}</span>
        <span class="row__text">
          <strong>${escapeHtml(step.action)}</strong>
          <span class="supporting-text">${escapeHtml(step.result)}</span>
          ${
            step.dispute
              ? `<span class="row__dispute">You say: ${escapeHtml(step.dispute.reason)}</span>`
              : ''
          }
        </span>
        ${
          active && step.evidence === null && step.confidence !== 'disputed'
            ? `<button type="button" class="btn btn--quiet" data-attach="${escapeHtml(step.id)}"
                       aria-label="Attach evidence to: ${escapeHtml(step.action)}">Attach evidence</button>`
            : ''
        }
        ${
          active && step.confidence !== 'disputed'
            ? `<button type="button" class="btn btn--quiet" data-dispute="${escapeHtml(step.id)}"
                       aria-label="Mark wrong: ${escapeHtml(step.action)}">Wrong</button>`
            : ''
        }
        ${
          active && step.confidence === 'disputed'
            ? `<button type="button" class="btn btn--quiet" data-undispute="${escapeHtml(step.id)}"
                       aria-label="Withdraw the dispute on: ${escapeHtml(step.action)}">Withdraw</button>`
            : ''
        }
      </div>
      ${evidence}
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
               Work you record yourself counts as verified by you · you were there.
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

function trailButton(task: TaskState, id: string, label: string): string {
  if (historyOf(task, id).length === 0) return ''
  return `<button type="button" class="btn btn--quiet" data-trail="${escapeHtml(id)}"
            aria-expanded="${showingTrail === id}"
            aria-label="What happened to: ${escapeHtml(label)}">${
              showingTrail === id ? 'Hide history' : 'History'
            }</button>`
}

function renderTrail(task: TaskState, id: string): string {
  if (showingTrail !== id) return ''
  const lines = historyOf(task, id).map(describeEntry).reverse()
  if (lines.length === 0) return ''

  return `<span class="trail">
      <ul class="events">
        ${lines
          .map(
            (l) => `<li class="event">
              <span class="event__when">${escapeHtml(new Date(l.at).toLocaleString('en-GB'))}</span>
              <span class="event__what"><strong>${escapeHtml(l.who)}</strong> ${escapeHtml(l.what)}${
                l.detail ? ` · ${escapeHtml(l.detail)}` : ''
              }</span>
            </li>`,
          )
          .join('')}
      </ul>
    </span>`
}

/* -------------------------------------------------------------------------- */
/* 3 · DECISIONS                                                               */
/* -------------------------------------------------------------------------- */

function renderDecisionRow(decision: Decision): string {
  return `<li class="decision-row">
      <div class="decision-row__choice">
        <span class="chip chip--${decision.source}">${decision.source === 'human' ? 'You' : 'Agent'}</span>
        <strong>${escapeHtml(decision.choice)}</strong>
      </div>
      <p>${escapeHtml(decision.rationale)}</p>
    </li>`
}

function renderDecisions(task: TaskState): string {
  const shown = task.decisions.slice(-MAX_ROWS).reverse()
  const body = shown.length
    ? `<ol class="decision-list">${shown.map(renderDecisionRow).join('')}</ol>${remainder(task.decisions.length)}`
    : '<p class="empty">No decision recorded yet.</p>'

  return `<section class="card" aria-labelledby="decisions-title" data-decisions>
      <div class="section-heading">
        <div>
          <p class="section-heading__eyebrow">Reasoning that survives</p>
          <h2 id="decisions-title" class="card__title">Decisions</h2>
        </div>
        <span class="count-badge">${task.decisions.length}</span>
      </div>
      ${body}
    </section>`
}

/* -------------------------------------------------------------------------- */
/* 3 · RULES TO FOLLOW                                                         */
/* -------------------------------------------------------------------------- */

function renderRules(task: TaskState): string {
  const decided = task.constraints.filter((c) => c.standing !== 'proposed')

  const rows = decided
    .map((c) => {
      const lifted = !c.active || c.standing === 'declined'
      if (editingIs('constraint', c.id)) return `<li>${editForm('Rule')}</li>`
      return `<li class="row${lifted ? ' row--lifted' : ''}">
        <span class="chip chip--${c.source}">${c.source === 'human' ? 'You' : 'Agent'}</span>
        <span class="row__text">${escapeHtml(c.rule)}${renderTrail(task, c.id)}</span>
        ${trailButton(task, c.id, c.rule)}
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
          <span class="muted"> · ${escapeHtml(r.reason)}</span>
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
           instead of understanding a problem · and loses the part still worth keeping.
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
        ${match.context ? `<span class="muted"> · ${highlight(match.context, q)}</span>` : ''}
      </span>
    </li>`
}

const FILTER_LABEL: Record<MatchKind, string> = {
  rule: 'Rules',
  rejection: 'Ruled out',
  step: 'Steps',
  evidence: 'Evidence',
  decision: 'Decisions',
  question: 'Questions',
  approval: 'Permissions',
  history: 'History',
}

function renderFilters(all: Match[]): string {
  const present = [...new Set(all.map((m) => m.kind))]
  if (present.length < 2) return ''

  const button = (kind: MatchKind | 'all', label: string, count: number) =>
    `<button type="button" class="btn btn--quiet" data-filter="${kind}"
             aria-pressed="${searchFilter === kind}">${escapeHtml(label)} (${count})</button>`

  return `<div class="actions search__filters">
      ${button('all', 'All', all.length)}
      ${present
        .map((kind) => button(kind, FILTER_LABEL[kind], all.filter((m) => m.kind === kind).length))
        .join('')}
    </div>`
}

function renderSearchResults(task: TaskState | null): string {
  const q = query()
  const found = task ? searchTask(task, q) : []
  const here = searchFilter === 'all' ? found : found.filter((m) => m.kind === searchFilter)
  const elsewhere =
    searchFilter === 'all' ? searchTasks(allTasks, q).filter((t) => t.id !== task?.id) : []

  const hereBody = here.length
    ? `<ul class="rows">${here
        .slice(0, 40)
        .map((m) => renderMatch(m, q))
        .join('')}</ul>
       ${here.length > 40 ? `<p class="muted">${here.length - 40} more not shown · narrow the search.</p>` : ''}`
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
              ${t.next ? `<span class="muted"> · ${highlight(t.next, q)}</span>` : ''}
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
      ${renderFilters(found)}
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
          <span class="muted"> · ${escapeHtml(t.next ?? 'no next action')}</span>
          ${
            summariseNeeds(needsYou(t))
              ? `<span class="needs__badge">${escapeHtml(summariseNeeds(needsYou(t))!)}</span>`
              : ''
          }
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
          <button type="button" id="new-task" class="btn" data-new-task>New task</button>
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
          <input id="import-file" type="file" accept=".md,.markdown,.json,text/markdown"
                 aria-label="Choose a Keydler file to import" hidden />
        </div>
      </div>
    </details>`
}

function renderOffer(): string {
  if (!offered) return ''
  const counts = [
    `${offered.steps.length} ${plural(offered.steps.length, 'step', 'steps')}`,
    `${activeConstraints(offered).length} ${plural(activeConstraints(offered).length, 'rule', 'rules')}`,
    `v${offered.version}`,
  ].join(' · ')

  return `<section class="card card--away" aria-labelledby="offer-title">
      <h2 id="offer-title" class="card__title">A shared Keydler</h2>
      <p class="muted">
        Somebody sent you this link, and the whole log travelled inside it · no
        server saw it. Nothing has been written here yet.
      </p>
      <ul class="rows">
        <li class="row">
          <span class="chip chip--human">shared</span>
          <span class="row__text">
            <strong>${escapeHtml(offered.title)}</strong>
            <span class="muted"> · ${escapeHtml(counts)}</span>
          </span>
        </li>
      </ul>
      <p class="muted">
        Taking it makes a <strong>copy on this device</strong>. It does not stay in
        step with theirs: from then on, the two are separate logs.
      </p>
      <div class="actions">
        <button type="button" id="accept-link" class="btn btn--primary">Take a copy</button>
        <button type="button" id="decline-link" class="btn">No thanks</button>
      </div>
    </section>`
}

function renderLastWrite(task: TaskState): string {
  const when = sinceThen(task.updatedAt)
  if (when === null) return ''
  return `<p class="muted page-head__when">Last written ${escapeHtml(when)}.</p>`
}

function carryableRules(): string {
  const open = store.currentTask()
  const rules = open ? activeConstraints(open) : []
  if (rules.length === 0) return ''

  return `<div class="field field--check">
      <input id="carry-rules" type="checkbox"${carryRules ? ' checked' : ''} />
      <label for="carry-rules">
        Carry over the ${rules.length} ${plural(rules.length, 'rule', 'rules')} from
        “${escapeHtml(open!.title)}”
      </label>
    </div>`
}

function renderAgentLive(): string {
  const call = recentlyActive()
  if (!call) return ''
  const when = sinceThen(call.at)
  if (when === null) return ''

  return `<p class="agent-live" role="status">
      An agent called <code>${escapeHtml(call.tool)}</code> ${escapeHtml(when)}${
        call.refused ? ' · and it was refused' : ''
      }.
    </p>`
}

function renderOffline(): string {
  if (online) return ''
  return `<p class="offline" role="status">
      <strong>Offline.</strong> Everything here is on this device, so nothing stops ·
      the page and this log both work without a network.
    </p>`
}

function renderShortcuts(): string {
  if (!showingShortcuts) return ''
  const rows = SHORTCUTS.map(
    (s) => `<li class="row">
        <kbd>${escapeHtml(s.key)}</kbd>
        <span class="row__text">${escapeHtml(s.what)}</span>
      </li>`,
  ).join('')

  return `<section id="shortcuts" class="card" aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title" class="card__title">Keyboard</h2>
      <ul class="rows">${rows}</ul>
      <div class="actions">
        <button type="button" id="close-shortcuts" class="btn">Close</button>
      </div>
    </section>`
}

function renderNeeds(task: TaskState): string {
  const needs = needsYou(task)
  if (needs.length === 0) return ''

  const items = needs
    .map((n) => `<li><a href="${n.anchor}">${escapeHtml(n.label)}</a></li>`)
    .join('')

  return `<nav class="needs" aria-label="What needs you">
      <p class="needs__title">Needs you</p>
      <ul class="needs__list">${items}</ul>
    </nav>`
}

function renderPermission(task: TaskState): string {
  const waiting = pendingApprovals(task)
  if (waiting.length === 0) return ''

  const rows = waiting
    .map(
      (a) => `<li class="review">
          <div class="row">
            <span class="chip chip--claimed">blocked</span>
            <span class="row__text">
              <strong>${escapeHtml(a.action)}</strong>
              <span class="muted"> · ${escapeHtml(a.why)}</span>
            </span>
            <button type="button" class="btn btn--primary" data-allow="${escapeHtml(a.id)}"
                    aria-label="Allow: ${escapeHtml(a.action)}">Allow</button>
            <button type="button" class="btn btn--danger" data-deny="${escapeHtml(a.id)}"
                    aria-label="Deny: ${escapeHtml(a.action)}">Deny</button>
          </div>
        </li>`,
    )
    .join('')

  return `<section class="card card--permission" aria-labelledby="permission-title">
      <h2 id="permission-title" class="card__title">Permission to act</h2>
      <p class="muted">
        An agent is <strong>waiting on this right now</strong> · it stopped before doing
        something it cannot undo. If nobody answers, it is told plainly that silence is
        not approval.
      </p>
      <ul class="rows">${rows}</ul>
    </section>`
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
            ${l.detail ? `<span class="muted"> · ${escapeHtml(l.detail)}</span>` : ''}
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
                          placeholder="Answer in your own words · the next conversation reads this"></textarea>
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
              <span class="muted"> · ${escapeHtml(q.why)}</span>
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
            <span class="muted"> · ${escapeHtml(q.answer ?? '')}</span>
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
      <button type="button" id="copy-link" class="btn btn--quiet">Copy a link that carries this log</button>
      <button type="button" id="copy-state" class="btn btn--quiet">Copy the log as text</button>
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
            <span class="muted"> · ${escapeHtml(secret.purpose)}</span>
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
        export. This is not an audited secret manager · and anything you reveal on
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
      text: `${r.approach} · ${r.reason}`,
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
  const waiting = task.steps.filter(
    (s) => s.evidence !== null && s.confidence !== 'human_verified' && s.confidence !== 'disputed',
  )
  if (waiting.length === 0) return ''

  const rows = waiting
    .slice(0, MAX_ROWS)
    .map((s) =>
      disputing === s.id
        ? `<li class="review">${disputeForm(s)}</li>`
        : `<li class="review">
        <div class="row review__heading">
          <span class="chip chip--evidence">${escapeHtml(s.evidence!.kind)}</span>
          <span class="row__text"><strong>${escapeHtml(s.action)}</strong></span>
        </div>
        <pre>${escapeHtml(s.evidence!.content)}</pre>
        <div class="review__action">
          <button type="button" class="btn btn--primary" data-verify="${escapeHtml(s.id)}"
                  aria-label="Approve the evidence for: ${escapeHtml(s.action)}">Approve</button>
          <button type="button" class="btn btn--danger" data-dispute="${escapeHtml(s.id)}"
                  aria-label="Mark wrong: ${escapeHtml(s.action)}">Wrong</button>
        </div>
      </li>`,
    )
    .join('')

  return `<section class="card" aria-labelledby="evidence-title">
      <h2 id="evidence-title" class="card__title">Evidence to review</h2>
      <p class="muted">
        Read it before you decide · your click is what says a human checked this.
        Nothing an agent attaches counts as verified on its own, and “Wrong”
        marks it so every later conversation sees your reason.
      </p>
      <ul class="rows">${rows}</ul>
      ${remainder(waiting.length)}
    </section>`
}

/* -------------------------------------------------------------------------- */
/* 7 · PERSISTENT AUDIT                                                        */
/* -------------------------------------------------------------------------- */

const MAX_AUDIT_ROWS = 12

function auditVersion(entry: AuditEntry): string {
  return entry.versionBefore === entry.versionAfter
    ? `v${entry.versionBefore}`
    : `v${entry.versionBefore} → v${entry.versionAfter}`
}

function renderAudit(task: TaskState): string {
  const shown = task.audit.slice(-MAX_AUDIT_ROWS).reverse()
  const rows = shown
    .map((entry) => {
      const repeated = entry.repeated && entry.repeated > 1 ? ` · repeated ${entry.repeated}×` : ''
      const time = new Date(entry.at)
      const validTime = Number.isFinite(time.getTime())
      const datetime = validTime ? time.toISOString() : ''
      const timeLabel = validTime
        ? time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : 'Unknown time'
      return `<li class="audit-row audit-row--${entry.outcome}">
        <span class="audit-marker" aria-hidden="true"></span>
        <div class="audit-row__content">
          <div class="audit-row__meta">
            <strong>${escapeHtml(entry.operation.replaceAll('_', ' '))}</strong>
            <span>${entry.actor === 'human' ? 'Human' : 'Agent'} · ${auditVersion(entry)}</span>
          </div>
          <p>${escapeHtml(entry.detail)}${repeated}</p>
        </div>
        <time${datetime ? ` datetime="${datetime}"` : ''}>${timeLabel}</time>
      </li>`
    })
    .join('')

  return `<section class="card" aria-labelledby="audit-title" data-persistent-audit>
      <div class="section-heading">
        <div>
          <p class="section-heading__eyebrow">Stored with this task</p>
          <h2 id="audit-title" class="card__title">Persistent audit</h2>
        </div>
        <span class="count-badge">${task.audit.length}</span>
      </div>
      <p class="supporting-text">Applied and refused writes remain here after reload.</p>
      <ol class="audit-list">${rows}</ol>
      ${remainder(task.audit.length)}
    </section>`
}

/* -------------------------------------------------------------------------- */
/* 7 · ACTIVITY                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Le dernier refus, dit en langage humain.
 *
 * Le témoin d'appels sait qu'un appel a été refusé, pas pourquoi. Le journal
 * d'audit, lui, porte le motif · et c'est le motif qui décide de la phrase. Un
 * refus pour état périmé n'est pas une panne : c'est la supervision qui
 * fonctionne, et la page doit le dire ainsi.
 */
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
        its own memory, not from this log · check what it recorded.
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

  return `<section class="card card--live" aria-labelledby="activity-title" data-live-calls>
      <div class="section-heading">
        <div>
          <p class="section-heading__eyebrow">Live tool calls · this page session only</p>
          <h2 id="activity-title" class="card__title">Activity</h2>
        </div>
        <span class="count-badge">${total}</span>
      </div>
      ${alert ? `<div class="notice notice--stale" role="status"><p>${escapeHtml(alert)}</p></div>` : ''}
      <p class="supporting-text">${total} tool ${plural(total, 'call', 'calls')} so far, ${refused} refused.</p>
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
          ${line.detail ? `<span class="muted"> · ${escapeHtml(line.detail)}</span>` : ''}
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
        Everything recorded on this task, newest first · including writes that
        were refused. The oldest entries are dropped once the log gets long.
      </p>
      ${rows ? `<ol class="events">${rows}</ol>` : '<p class="empty">Nothing yet.</p>'}
      ${more}
    </section>`
}

function renderToolInspector(): string {
  const rows = ALL_TOOLS.map((tool) => {
    const reads = READ_TOOLS.includes(tool)
    return `<li class="review" data-tool="${escapeHtml(tool.name)}">
        <div class="row">
          <span class="chip chip--${reads ? 'evidence' : 'claimed'}">${reads ? 'reads' : 'writes'}</span>
          <span class="row__text"><code>${escapeHtml(tool.name)}</code></span>
        </div>
        <pre>${escapeHtml(tool.description)}</pre>
        <pre>${escapeHtml(JSON.stringify(tool.inputSchema, null, 2))}</pre>
      </li>`
  }).join('')

  return `<details id="tools" class="technical">
      <summary>What an agent reads · ${ALL_TOOLS.length} tools, verbatim</summary>
      <div class="technical__body">
        <p class="muted">
          The registered tool objects themselves: the same descriptions and schemas
          an agent receives through WebMCP, not a summary written for this page.
        </p>
        <ul class="rows">${rows}</ul>
      </div>
    </details>`
}

function renderTechnical(task: TaskState | null): string {
  const { phase, availability, toolNames, error, observedTools, lifecycle } = getRegistrationState()

  const surface = availability.supported ? availability.surface : 'none'
  const webmcp =
    phase === 'registered' || phase === 'partial'
      ? `<p><strong>WebMCP active</strong> · ${toolNames.length} ${plural(toolNames.length, 'tool', 'tools')} registered, read from <code>${surface}.modelContext</code>.</p>
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
        <p class="muted">Lifecycle: <strong>${lifecycle.mode}</strong> · ${escapeHtml(lifecycle.reason)}</p>
        <p class="muted">${escapeHtml(describeStorage(storage))}</p>
        ${
          storage.persisted === false
            ? `<div class="actions">
                 <button type="button" id="persist" class="btn">Ask the browser to keep this</button>
               </div>`
            : ''
        }
        ${
          task
            ? `<p class="mono">Task ID: ${escapeHtml(task.id)} · version ${task.version}</p>
               <h3>What <code>resume_task</code> returns</h3>
               <pre>${escapeHtml(
                 renderTaskState(task, { url: taskUrl(task.id), credentials }),
               )}</pre>`
            : ''
        }
        ${renderToolInspector()}
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

function renderWorkspaceNav(): string {
  const cloud = getCloudState()
  const storageLabel =
    cloud.settings.cloudSyncEnabled && cloud.auth === 'signed-in' ? 'Cloud sync on' : 'Local-first'
  const storageDetail =
    cloud.sync === 'syncing'
      ? 'Synchronizing now'
      : cloud.sync === 'synced' && cloud.lastSyncedAt
        ? `Synced ${new Date(cloud.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : cloud.user
          ? 'Cloud sync is optional'
          : 'Stored on this device'
  return `<nav class="workspace-nav" aria-label="Workspace navigation">
      <div class="workspace-nav__heading">
        <span class="workspace-nav__label">Private workspace</span>
        <strong>${escapeHtml(cloud.workspace?.name ?? 'Local memory')}</strong>
        <span class="preview-flag">${cloud.user ? 'Authenticated' : 'Local session'}</span>
      </div>
      <div class="workspace-nav__links" data-nav-links>
        <a class="workspace-nav__link is-active" href="#workspace-overview">
          <span aria-hidden="true">01</span> Overview
        </a>
        <a class="workspace-nav__link" href="#memory-detail">
          <span aria-hidden="true">02</span> Memory
        </a>
        <a class="workspace-nav__link" href="#connections-preview">
          <span aria-hidden="true">03</span> Connections
        </a>
        <a class="workspace-nav__link" href="#security-preview">
          <span aria-hidden="true">04</span> Security
        </a>
        <a class="workspace-nav__link" href="#memory-audit">
          <span aria-hidden="true">05</span> Console
        </a>
        <a class="workspace-nav__link" href="#settings-preview">
          <span aria-hidden="true">06</span> Settings
        </a>
      </div>
      <div class="workspace-nav__storage">
        <span class="status-dot status-dot--local" aria-hidden="true"></span>
        <span><strong>${storageLabel}</strong><small>${storageDetail}</small></span>
      </div>
    </nav>`
}

function renderWorkspaceOverview(task: TaskState): string {
  const acceptedRules = task.constraints.filter(
    (constraint) => constraint.standing === 'accepted' && constraint.active,
  ).length
  const verifiedSteps = task.steps.filter((step) => step.confidence === 'human_verified').length
  const toolCount = getRegistrationState().toolNames.length
  const activeMemories = allTasks.filter((candidate) => !candidate.archived).length || 1

  return `<section id="workspace-overview" class="workspace-overview prototype-section" aria-labelledby="workspace-title">
      <div class="workspace-overview__intro">
        <p class="section-heading__eyebrow">AI memory workspace</p>
        <h2 id="workspace-title">One place for the context your agents must not lose.</h2>
        <p>
          Review durable memories, supervise what agents write, and control how future
          conversations pick the work back up.
        </p>
        <div class="actions">
          <a class="btn btn--primary" href="#memory-detail">Open current memory</a>
          <button type="button" id="new-memory" class="btn" data-new-task>New memory</button>
        </div>
      </div>
      <div class="workspace-metrics" aria-label="Current workspace facts">
        <article class="metric-card">
          <span>Active memories</span>
          <strong>${activeMemories}</strong>
          <small>${getCloudState().settings.cloudSyncEnabled ? 'Available across signed-in devices' : 'Stored in this browser'}</small>
        </article>
        <article class="metric-card">
          <span>Binding rules</span>
          <strong>${acceptedRules}</strong>
          <small>Applied to the current task</small>
        </article>
        <article class="metric-card">
          <span>Human verified</span>
          <strong>${verifiedSteps}</strong>
          <small>${plural(verifiedSteps, 'step', 'steps')} reviewed</small>
        </article>
        <article class="metric-card">
          <span>WebMCP tools</span>
          <strong>${toolCount}</strong>
          <small>${toolCount > 0 ? 'Available in this browser' : 'Browser support is off'}</small>
        </article>
      </div>
      <article class="memory-summary">
        <div class="memory-summary__main">
          <span class="memory-summary__status"><span aria-hidden="true"></span>${task.status}</span>
          <div>
            <p class="memory-summary__kicker">Current memory</p>
            <h2>${escapeHtml(task.title)}</h2>
            <p>${task.next ? `Next: ${escapeHtml(task.next)}` : 'No next action recorded.'}</p>
          </div>
        </div>
        <div class="memory-summary__meta">
          <span>Version ${task.version}</span>
          <span>${task.steps.length} ${plural(task.steps.length, 'step', 'steps')}</span>
          <a href="#memory-detail">View memory <span aria-hidden="true">→</span></a>
        </div>
      </article>
    </section>`
}

const CONNECTOR_PROVIDERS: readonly {
  provider: ConnectorProvider
  mark: string
  name: string
  detail: string
}[] = [
  {
    provider: 'openai',
    mark: 'O',
    name: 'OpenAI API',
    detail: 'Verify and store a user-supplied OpenAI API key in the encrypted server vault.',
  },
  {
    provider: 'anthropic',
    mark: 'A',
    name: 'Anthropic API',
    detail: 'Verify an Anthropic API key without exposing it again to the browser.',
  },
  {
    provider: 'gemini',
    mark: 'G',
    name: 'Gemini API',
    detail: 'Verify a Gemini API key through the same scoped connector service.',
  },
] as const

function renderConnectionsPreview(): string {
  const cloud = getCloudState()
  const cards = CONNECTOR_PROVIDERS.map((connector) => {
    const saved = cloud.connectors.find((item) => item.provider === connector.provider)
    const connected = saved?.status === 'connected'
    const state = connected
      ? 'Connected'
      : saved?.status === 'error'
        ? 'Needs attention'
        : 'Not connected'
    const action = cloud.user
      ? connectorEditing === connector.provider
        ? `<form class="connector-form" data-connector-form="${connector.provider}" novalidate>
            <div class="field"><label for="connector-key-${connector.provider}">API key</label><input id="connector-key-${connector.provider}" type="password" autocomplete="off" spellcheck="false" maxlength="512" /></div>
            <div class="actions"><button type="submit" class="btn btn--primary">Verify & connect</button><button type="button" class="btn" data-cancel-connector>Cancel</button></div>
          </form>`
        : connected
          ? `<button type="button" class="btn btn--danger" data-disconnect-provider="${connector.provider}">Disconnect</button>`
          : `<button type="button" class="btn btn--tonal" data-connect-provider="${connector.provider}">Connect securely</button>`
      : '<button type="button" class="btn btn--tonal" data-open-auth>Sign in to connect</button>'

    return `<article class="connector-card">
        <div class="connector-card__top">
          <span class="connector-mark" aria-hidden="true">${connector.mark}</span>
          <span class="connector-state${connected ? ' connector-state--on' : ''}">${state}</span>
        </div>
        <h3>${connector.name}</h3>
        <p>${connector.detail}</p>
        ${saved?.error ? `<p class="connector-card__error" role="status">${escapeHtml(saved.error)}</p>` : ''}
        ${action}
      </article>`
  }).join('')

  return `<section id="connections-preview" class="prototype-section prototype-section--connections" aria-labelledby="connections-title">
      <header class="prototype-heading">
        <div>
          <p class="section-heading__eyebrow">Connection centre</p>
          <h2 id="connections-title">Bring the memory to every compatible agent.</h2>
        </div>
        <span class="preview-flag">Encrypted connections</span>
      </header>
      <p class="prototype-heading__copy">
        Provider keys are verified by a scoped server function, encrypted with AES-GCM and never
        returned to this page. Connecting an API does not import private conversation history.
      </p>
      <div class="connector-grid">${cards}</div>
      <div class="connection-explainer">
        <span class="connection-explainer__mark" aria-hidden="true">W</span>
        <div>
          <strong>WebMCP is the shared connection layer</strong>
          <p>The ${ALL_TOOLS.length} tools on this page expose the same supervised memory to any compatible WebMCP agent. Provider API connections are optional and separate.</p>
        </div>
        <a href="#memory-detail">Inspect tools</a>
      </div>
    </section>`
}

function renderSecurityPreview(task: TaskState): string {
  const cloud = getCloudState()
  return `<section id="security-preview" class="prototype-section prototype-section--security" aria-labelledby="security-title">
      <header class="prototype-heading">
        <div>
          <p class="section-heading__eyebrow">Access & privacy</p>
          <h2 id="security-title">The security controls users will understand.</h2>
        </div>
        <span class="preview-flag">Enforced controls</span>
      </header>
      <div class="security-grid">
        <article class="security-card security-card--actual">
          <span class="security-card__state">Active now</span>
          <h3>Local private storage</h3>
          <p>IndexedDB keeps the offline copy on this device. Credentials are sealed with PBKDF2 and AES-GCM.</p>
          <span class="security-card__detail mono">Task ${escapeHtml(task.id)}</span>
        </article>
        <article class="security-card">
          <span class="security-card__state">${cloud.user ? 'Active now' : cloud.configured ? 'Available' : 'Not configured'}</span>
          <h3>Passwordless sign-in</h3>
          <p>Single-use PKCE links, rotating refresh tokens and a session that ends when this browser session closes.</p>
          ${cloud.user ? `<span class="security-card__detail mono">${escapeHtml(cloud.user.email)}</span>` : '<button type="button" class="btn btn--text" data-open-auth>Sign in securely</button>'}
        </article>
        <article class="security-card">
          <span class="security-card__state">${cloud.user ? 'Active now' : 'Sign-in required'}</span>
          <h3>Connection permissions</h3>
          <p>Postgres row-level security isolates each workspace. Owners, editors and viewers receive distinct server-enforced rights.</p>
          <a class="btn btn--text" href="#connections-preview">Review connections</a>
        </article>
        <article class="security-card security-card--actual">
          <span class="security-card__state">Active now</span>
          <h3>Append-only audit</h3>
          <p>${task.audit.length} ${plural(task.audit.length, 'event is', 'events are')} already recorded for the current memory.</p>
          <a class="btn btn--text" href="#memory-audit">Open audit</a>
        </article>
      </div>
    </section>`
}

function renderConfigurationPreview(): string {
  const cloud = getCloudState()
  const enabled = new Set(enabledToolNames())
  const toolControls = ALL_TOOLS.map(
    (tool) =>
      `<label class="tool-permission"><input type="checkbox" data-tool-permission="${escapeHtml(tool.name)}" ${enabled.has(tool.name) ? 'checked' : ''} /><span><strong>${escapeHtml(tool.title ?? tool.name)}</strong><small>${tool.annotations?.readOnlyHint ? 'Read-only' : 'Can write supervised memory'}</small></span></label>`,
  ).join('')
  return `<section id="settings-preview" class="prototype-section prototype-section--settings" aria-labelledby="settings-title">
      <header class="prototype-heading">
        <div>
          <p class="section-heading__eyebrow">Workspace configuration</p>
          <h2 id="settings-title">Every important behavior, under your control.</h2>
        </div>
        <span class="preview-flag">Live configuration</span>
      </header>
      <p class="prototype-heading__copy">These settings are real. Local mode never uploads a task; cloud mode requires an authenticated workspace and applies row-level access policies.</p>
      <div class="settings-preview">
        <article class="settings-group">
          <div><h3>Memory storage</h3><p>Choose where supervised memory is authoritative.</p></div>
          <div class="segmented-preview" role="group" aria-label="Storage mode">
            <button type="button" data-storage-mode="local" class="${cloud.settings.cloudSyncEnabled ? '' : 'segmented-preview__active'}">Local</button>
            <button type="button" data-storage-mode="cloud" class="${cloud.settings.cloudSyncEnabled ? 'segmented-preview__active' : ''}" ${cloud.user ? '' : 'disabled'}>Cloud sync</button>
          </div>
          ${cloud.user ? `<small class="settings-group__status">${cloud.sync === 'synced' ? 'Last sync completed.' : cloud.sync === 'error' ? `Sync error: ${escapeHtml(cloud.error ?? 'unknown')}` : 'Signed-in workspace ready.'}</small>` : '<button type="button" class="btn btn--text" data-open-auth>Sign in to enable cloud sync</button>'}
        </article>
        <article class="settings-group">
          <div><h3>Agent write access</h3><p>Require version checks and keep human approval authoritative.</p></div>
          <button type="button" class="switch-preview switch-preview--on" aria-label="Strict agent writes are enforced" aria-pressed="true" disabled><span></span></button>
          <small class="settings-group__status">Always enforced by the WebMCP write contract.</small>
        </article>
        <article class="settings-group">
          <div><h3>Cloud audit retention</h3><p>Choose when server audit metadata is pruned. Task memory is never silently deleted.</p></div>
          <label class="field field--compact" for="retention-days"><span>Retention window</span><select id="retention-days" class="select-preview" ${cloud.user ? '' : 'disabled'}>${[7, 30, 90, 365].map((days) => `<option value="${days}" ${cloud.settings.retentionDays === days ? 'selected' : ''}>${days} days</option>`).join('')}</select></label>
        </article>
        <article class="settings-group settings-group--tools">
          <div><h3>Tool permissions</h3><p>Disable any WebMCP capability you do not want exposed in this browser.</p></div>
          <div class="tool-permissions">${toolControls}</div>
        </article>
      </div>
    </section>`
}

function renderProductShell(task: TaskState): string {
  return `<div class="workspace-shell">
      ${renderWorkspaceNav()}
      <div class="workspace-content">
        ${renderPreviewNotice()}
        ${renderWorkspaceOverview(task)}
        <section id="memory-detail" class="memory-detail" aria-label="Current memory detail">
          ${renderDashboard(task)}
        </section>
        ${renderConnectionsPreview()}
        ${renderSecurityPreview(task)}
        ${renderConfigurationPreview()}
        <footer class="product-footer">
          <span>Keydler · WebMCP memory workspace · © 2026</span>
          <span>${getCloudState().user ? 'Authenticated workspace · RLS enforced' : 'Local-first · no account required'}</span>
          <p class="product-footer__credits">Google Fonts · Material Design 3 · Google Icons</p>
          <p class="product-footer__credits product-footer__credits--models">Claude Opus 5 &amp; Sonnet 5 · GPT-5.6 Sol · Cursor Grok 4.6 Extra High Fast · GPT-5.6 Luna</p>
        </footer>
      </div>
    </div>`
}

function renderDashboard(task: TaskState): string {
  const demo =
    task.id === DEMO_TASK_ID
      ? `<aside class="demo-notice" data-demo-notice aria-label="Demonstration data">
          <span class="demo-notice__icon" aria-hidden="true">i</span>
          <p><strong>Sample data.</strong> The steps, evidence and results below illustrate the product; they are not real results from your machine.</p>
        </aside>`
      : task.id.startsWith('mesure-')
        ? `<aside class="demo-notice" data-demo-notice aria-label="Experiment fixture data">
            <span class="demo-notice__icon" aria-hidden="true">i</span>
            <p><strong>Experiment fixture.</strong> This task is a controlled evaluation scenario. Its prior step and evidence URL are prepared context, not results from your machine.</p>
          </aside>`
        : ''

  return `<header class="page-head">
      <div class="eyebrow-row">
        <p class="page-head__eyebrow">Keydler</p>
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
      <p class="page-head__meta">Task ${escapeHtml(task.id)} · Updated ${new Date(task.updatedAt).toLocaleString('en-GB')}</p>
      ${renderLastWrite(task)}
      ${renderAgentLive()}
      ${renderSwitcher(task)}
      ${renderSearchBox()}
    </header>
    ${demo}
    ${noticeBlock()}
    ${alertBlock()}
    ${searching() ? renderSearchResults(task) : ''}
    ${renderHandoff(task)}
    ${renderOffline()}
    ${renderOffer()}
    ${renderShortcuts()}
    ${
      searching()
        ? ''
        : `<div class="dashboard-grid">
      <div class="dashboard-primary">
        ${renderNeeds(task)}
        ${renderPermission(task)}
        ${renderAway(task)}
        ${renderNext(task)}
        ${renderWaiting(task)}
        ${renderReadyForAI(task)}
        ${renderCompletedWork(task)}
        ${renderDecisions(task)}
        ${renderEvidence(task)}
      </div>
      <aside class="dashboard-secondary" aria-label="Task guardrails">
        ${renderRules(task)}
        ${renderDontRetry(task)}
        ${renderCredentials(task)}
        ${renderProposals(task)}
      </aside>
      <div id="memory-audit" class="dashboard-operations">
        ${renderAudit(task)}
        ${renderActivity(task)}
        ${renderHistory(task)}
      </div>
    </div>`
    }
    ${renderTechnical(task)}`
}

function renderBody(): string {
  const { status, task, error, boundId } = store.getSnapshot()
  const appBar = renderAppBar(task)
  const account = renderCloudAuthPanel()

  if (status === 'loading') return `${appBar}${account}<p class="muted loading-state">Loading…</p>`

  if (status === 'error') {
    return `${appBar}${account}<div class="notice notice--error" role="alert">
        <p>${escapeHtml(humanMessage(new Error(error ?? ''), 'Opening the task'))}</p>
      </div>${renderTechnical(null)}`
  }

  if (status === 'missing') {
    // Quand un lien porte le cahier, dire « il n'existe pas ici » en même temps
    // qu'on propose de le prendre est une contradiction à l'écran.
    const alarm =
      offered || linkPending
        ? ''
        : `<div class="notice notice--warn" role="alert">
             <p><strong>This task does not exist on this device.</strong></p>
             <p>The address points at <code>${escapeHtml(boundId ?? '')}</code>, which is not here.
                No other task has been opened in its place.</p>
           </div>`
    // `renderOffer()` vivait seulement dans `renderDashboard`, qui exige une
    // tâche ouverte · précisément ce que « missing » n'a pas. Sans cet appel
    // ici, un lien reçu pour une tâche absente de cet appareil n'affichait
    // jamais la proposition de la prendre.
    return `${alarm}${renderOffer()}${renderLanding()}`
  }

  // Le formulaire de création prend toute la place, même quand un cahier est
  // déjà ouvert : sans cela, « New task » ne montrait rien depuis un tableau
  // de bord, le formulaire ne vivant que dans l'écran d'accueil.
  //
  // La landing possède sa propre navigation M3.
  // L'app bar applicative reste réservée au workspace pour éviter deux barres
  // superposées sur la page publique.
  if (creating) return renderLanding()
  return task
    ? `<div class="silk-background" data-silk-background aria-hidden="true"></div>${appBar}${account}${renderProductShell(task)}`
    : renderLanding()
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

function bindPreviewInteractions(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preview-action]')) {
    button.addEventListener('click', () => {
      previewNotice = button.dataset.previewAction ?? 'This control is part of the design preview.'
      renderNow()
      document.querySelector<HTMLElement>('[data-preview-feedback]')?.focus()
    })
  }

  document.querySelector('[data-dismiss-preview]')?.addEventListener('click', () => {
    previewNotice = null
    renderNow()
  })
}

function cloudFailure(action: string, error: unknown): void {
  humanError = humanMessage(error, action)
  scheduleRender()
}

function bindCloudControls(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-auth]')) {
    button.addEventListener('click', () => {
      previewAuthOpen = true
      renderNow()
      document.querySelector<HTMLInputElement>('#auth-email')?.focus()
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-close-auth]')) {
    button.addEventListener('click', () => {
      previewAuthOpen = false
      renderNow()
    })
  }

  document.querySelector<HTMLFormElement>('#cloud-auth')?.addEventListener('submit', (event) => {
    event.preventDefault()
    humanError = null
    const email = drafts['auth-email']
    void sendMagicLink(email).then(
      () => {
        previewAuthOpen = false
        drafts['auth-email'] = ''
        previewNotice = 'Secure sign-in link sent. Open it in this browser to finish signing in.'
        scheduleRender()
      },
      (error: unknown) => cloudFailure('Sending the sign-in link', error),
    )
  })

  document.querySelector('#sign-out')?.addEventListener('click', () => {
    void signOut(false).then(
      () => {
        previewAuthOpen = false
        previewNotice = 'This browser session is signed out. Local memories remain on this device.'
        scheduleRender()
      },
      (error: unknown) => cloudFailure('Signing out', error),
    )
  })

  document.querySelector('#sign-out-everywhere')?.addEventListener('click', () => {
    void signOut(true).then(
      () => {
        previewAuthOpen = false
        previewNotice = 'All refresh-token sessions for this account were revoked.'
        scheduleRender()
      },
      (error: unknown) => cloudFailure('Revoking sessions', error),
    )
  })

  document.querySelector('#sync-now')?.addEventListener('click', () => {
    void syncNow().then(
      () => scheduleRender(),
      (error: unknown) => cloudFailure('Synchronizing the workspace', error),
    )
  })

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-connect-provider]')) {
    button.addEventListener('click', () => {
      connectorEditing = button.dataset.connectProvider as ConnectorProvider
      humanError = null
      renderNow()
      document.querySelector<HTMLInputElement>(`#connector-key-${connectorEditing}`)?.focus()
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-cancel-connector]')) {
    button.addEventListener('click', () => {
      connectorEditing = null
      renderNow()
    })
  }

  for (const form of document.querySelectorAll<HTMLFormElement>('[data-connector-form]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const provider = form.dataset.connectorForm as ConnectorProvider
      const cloud = getCloudState()
      if (!cloud.workspace)
        return cloudFailure('Connecting the provider', new Error('Sign in first.'))
      const key = drafts[`connector-key-${provider}`]
      void connectProvider(cloud.workspace.id, provider, key).then(
        async () => {
          drafts[`connector-key-${provider}`] = ''
          connectorEditing = null
          const connectors = await loadConnectors(cloud.workspace!.id)
          updateCloudState({ connectors })
          previewNotice = `${provider} was verified and connected. The key will not be shown again.`
          scheduleRender()
        },
        (error: unknown) => cloudFailure(`Connecting ${provider}`, error),
      )
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-disconnect-provider]')) {
    button.addEventListener('click', () => {
      const provider = button.dataset.disconnectProvider as ConnectorProvider
      const cloud = getCloudState()
      if (!cloud.workspace) return
      void disconnectProvider(cloud.workspace.id, provider).then(
        async () => {
          const connectors = await loadConnectors(cloud.workspace!.id)
          updateCloudState({ connectors })
          previewNotice = `${provider} was disconnected and its encrypted credential was deleted.`
          scheduleRender()
        },
        (error: unknown) => cloudFailure(`Disconnecting ${provider}`, error),
      )
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-storage-mode]')) {
    button.addEventListener('click', () => {
      const cloud = getCloudState()
      if (!cloud.workspace) {
        previewAuthOpen = true
        renderNow()
        return
      }
      const enabled = button.dataset.storageMode === 'cloud'
      const settings = { ...cloud.settings, cloudSyncEnabled: enabled }
      void saveSettings(cloud.workspace.id, settings).then(
        () => {
          updateCloudState({ settings, sync: enabled ? 'idle' : 'local-only', error: null })
          if (enabled) startCloudSync(cloud.workspace!.id)
          else stopCloudSync()
          previewNotice = enabled
            ? 'Cloud sync enabled. Local memories remain available offline.'
            : 'Cloud sync paused. New changes stay on this device.'
          scheduleRender()
        },
        (error: unknown) => cloudFailure('Changing storage mode', error),
      )
    })
  }

  document
    .querySelector<HTMLSelectElement>('#retention-days')
    ?.addEventListener('change', (event) => {
      const cloud = getCloudState()
      if (!cloud.workspace) return
      const value = Number((event.currentTarget as HTMLSelectElement).value)
      if (value !== 7 && value !== 30 && value !== 90 && value !== 365) return
      const retentionDays = value as 7 | 30 | 90 | 365
      const settings = { ...cloud.settings, retentionDays }
      void saveSettings(cloud.workspace.id, settings).then(
        () => {
          updateCloudState({ settings })
          previewNotice = `Cloud audit retention set to ${value} days.`
          scheduleRender()
        },
        (error: unknown) => cloudFailure('Changing retention', error),
      )
    })

  for (const input of document.querySelectorAll<HTMLInputElement>('[data-tool-permission]')) {
    input.addEventListener('change', () => {
      const name = input.dataset.toolPermission
      if (!name) return
      setToolEnabled(name, input.checked)
      const cloud = getCloudState()
      const settings = { ...cloud.settings, enabledTools: enabledToolNames() }
      updateCloudState({ settings })
      if (cloud.workspace)
        void saveSettings(cloud.workspace.id, settings).catch((error) =>
          cloudFailure('Saving tool permissions', error),
        )
      void refreshToolRegistration()
      if (
        getRegistrationState().lifecycle.mode === 'static' &&
        getRegistrationState().toolNames.includes(name) &&
        !input.checked
      ) {
        previewNotice =
          'Tool permissions saved. Reloading once so this browser can unregister the disabled tool.'
        scheduleRender()
        setTimeout(() => location.reload(), 150)
      }
    })
  }
}

function bindCreation(): void {
  const carryBox = document.querySelector<HTMLInputElement>('#carry-rules')
  if (carryBox) {
    carryBox.checked = carryRules
    for (const event of ['change', 'input']) {
      carryBox.addEventListener(event, () => {
        carryRules = carryBox.checked
      })
    }
  }

  const resetWorkspaceViewport = () => {
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }

  document.querySelectorAll('[data-start-create]').forEach((button) => {
    button.addEventListener('click', () => {
      creating = true
      renderNow()
      document.querySelector<HTMLInputElement>('#new-title')?.focus()
      document.querySelector('#create-task')?.scrollIntoView?.({ block: 'start' })
    })
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
    // Lu AVANT la création : ouvrir la nouvelle tâche remplace la courante.
    const source = carryRules ? store.currentTask() : null

    void store
      .createAndOpenTask(title, next)
      .then(() => {
        if (!source) return undefined
        return store.mutate((s) => copyRulesInto(s, source)).then(() => undefined)
      })
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

  const openPreparedDemo = () => {
    // `?mesure=N` charge la tâche de mesure N au lieu du cahier de
    // démonstration, pour que le protocole de mesure soit rejouable tel quel.
    const n = Number(new URLSearchParams(location.search).get('mesure'))
    void store
      .openPreparedTask(n ? buildMeasureTask(n) : buildDemoTask())
      .then(resetWorkspaceViewport)
  }

  for (const id of ['seed', 'seed-tour', 'seed-footer']) {
    document.querySelector(`#${id}`)?.addEventListener('click', openPreparedDemo)
  }
}

function bindSupervision(): void {
  document.querySelector('#edit-title')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) startEditing({ kind: 'title' }, task.title)
  })

  document.querySelector('#edit-goal')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) startEditing({ kind: 'goal' }, task.goal ?? '')
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
        : current.kind === 'goal'
          ? (state) => setGoal(state, value)
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

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-dispute]')) {
    b.addEventListener('click', () => {
      disputing = b.dataset.dispute!
      attaching = null
      answering = null
      editing = null
      loggingStep = false
      humanError = null
      drafts['dispute-reason'] = ''
      renderNow()
      document.querySelector<HTMLTextAreaElement>('#dispute-reason')?.focus()
    })
  }

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-undispute]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.undispute!
      humanAction('Withdrawing the dispute', (state) => withdrawDispute(state, id))
    })
  }

  document.querySelector('#cancel-dispute')?.addEventListener('click', () => {
    disputing = null
    drafts['dispute-reason'] = ''
    renderNow()
  })

  document.querySelector<HTMLFormElement>('#form-dispute')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const id = disputing
    const reason = drafts['dispute-reason'].trim()
    if (!id || !reason) return

    humanAction(
      'Marking the step wrong',
      (state) => disputeStep(state, id, reason),
      () => {
        disputing = null
        drafts['dispute-reason'] = ''
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

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-trail]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.trail!
      showingTrail = showingTrail === id ? null : id
      renderNow()
      document.querySelector<HTMLButtonElement>(`[data-trail="${id}"]`)?.focus()
    })
  }

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

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    b.addEventListener('click', () => {
      searchFilter = b.dataset.filter as MatchKind | 'all'
      renderNow()
    })
  }

  const searchField = document.querySelector<HTMLInputElement>('#search')
  searchField?.addEventListener('input', () => {
    // Un filtre gardé d'une recherche à l'autre fait croire à un résultat vide.
    searchFilter = 'all'
    scheduleRender()
  })
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

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-new-task]')) {
    button.addEventListener('click', () => {
      creating = true
      clearNotice()
      humanError = null
      renderNow()
      document.querySelector<HTMLInputElement>('#new-title')?.focus()
    })
  }

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
    if (file.size > MAX_IMPORT_BYTES) {
      humanError = humanMessage(new ImportTooLargeError(file.size), 'Importing the file')
      fileField.value = ''
      scheduleRender()
      return
    }
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

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-allow], [data-deny]')) {
    b.addEventListener('click', () => {
      const allow = b.dataset.allow !== undefined
      const id = (allow ? b.dataset.allow : b.dataset.deny)!
      humanAction(allow ? 'Allowing the action' : 'Refusing the action', (state) =>
        decideApproval(state, id, allow ? 'allowed' : 'denied'),
      )
    })
  }

  document.querySelector('#persist')?.addEventListener('click', () => {
    void askForPersistence()
      .then((granted) => {
        // Un clic sans effet visible se lit comme un bouton cassé. Chrome
        // accorde la durabilité sur des critères d'usage, pas sur demande.
        if (granted === true) {
          showNotice('The browser will keep this data unless you delete it yourself.')
        } else if (granted === false) {
          showNotice(
            'The browser declined for now. It usually grants this once the page has ' +
              'been used a few times; asking again later costs nothing.',
          )
        } else {
          showNotice('This browser does not answer that question. Export what matters.')
        }
      })
      .then(() => readStorage())
      .then((state) => {
        storage = state
        scheduleRender()
      })
  })

  document.querySelector('#close-shortcuts')?.addEventListener('click', () => {
    showingShortcuts = false
    renderNow()
  })

  document.querySelector('#accept-link')?.addEventListener('click', () => {
    const task = offered
    if (!task) return
    offered = null
    clearLinkFragment()
    humanError = null
    void store.importTasks([task]).then(
      () => store.openTask(task.id).catch(() => undefined),
      (error: unknown) => {
        humanError = humanMessage(error, 'Taking that copy')
        scheduleRender()
      },
    )
  })

  document.querySelector('#decline-link')?.addEventListener('click', () => {
    offered = null
    clearLinkFragment()
    renderNow()
  })

  document.querySelector('#copy-state')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    humanError = null
    // Pour les agents sans WebMCP · l'immense majorité aujourd'hui. Le texte
    // est celui de resume_task, pas une variante rédigée pour l'écran.
    const body = [
      'Read this before doing anything. It is the shared log for the task we are',
      'continuing; it holds the rules, the work already done, and what was ruled out.',
      '',
      renderTaskState(task, { url: taskUrl(task.id), credentials }),
      '',
      'Continue this task. Tell me what you are about to do before you do it.',
    ].join('\n')

    void navigator.clipboard?.writeText(body).then(
      () => showNotice('Copied. Paste it to any assistant · WebMCP or not.'),
      (error: unknown) => {
        humanError = humanMessage(error, 'Copying the log')
        scheduleRender()
      },
    )
  })

  document.querySelector('#copy-link')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (!task) return
    humanError = null
    void packTask(task)
      .then((packed) =>
        navigator.clipboard?.writeText(linkFor(location.origin, taskPath(task.id), packed)),
      )
      .then(
        () =>
          showNotice(
            'Link copied. It carries the whole log; the person you send it to gets a copy.',
          ),
        (error: unknown) => {
          humanError = humanMessage(error, 'Building that link')
          scheduleRender()
        },
      )
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

  document.querySelector('#reset-witness')?.addEventListener('click', () => resetCalls())

  document.querySelector('#export-one')?.addEventListener('click', () => {
    const task = store.currentTask()
    if (task) download(exportFilename(task), buildTaskExport(task))
  })

  document.querySelector('#export-all')?.addEventListener('click', () => {
    void store.allTasks().then(
      (tasks) => download('nightorders.md', buildFullExport(tasks)),
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

  if (!storageRead) {
    storageRead = true
    void readStorage().then((state) => {
      storage = state
      scheduleRender()
    })
  }

  if (!linkRead) {
    linkRead = true
    const packed = readLinkFragment()
    if (packed) {
      linkPending = true
      void unpackTask(packed).then(
        (task) => {
          linkPending = false
          offered = task
          scheduleRender()
        },
        (error: unknown) => {
          linkPending = false
          humanError = humanMessage(error, 'Reading that link')
          clearLinkFragment()
          scheduleRender()
        },
      )
    }
  }

  const waiting = openTask ? pendingApprovals(openTask).length + openQuestions(openTask).length : 0
  document.title = attentionTitle(document.title, waiting, looking())

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
  // depuis n'importe quel bouton · au clavier, on repart du début de la page.
  const focusedId =
    !focused && active instanceof HTMLElement && active.id && root.contains(active)
      ? active.id
      : null

  stopTextLoop?.()
  stopTextLoop = null
  stopSilkBackground?.()
  stopSilkBackground = null
  stopNavSpy?.()
  stopNavSpy = null

  root.innerHTML = `<main id="content">${renderBody()}</main>`

  bindDrafts()
  bindPreviewInteractions()
  bindCloudControls()
  bindCreation()
  bindSupervision()
  bindTechnical()

  const silkHost = root.querySelector<HTMLElement>('[data-silk-background]')
  if (silkHost) {
    stopSilkBackground = mountSilkBackground(silkHost)
  }

  const navLinksHost = root.querySelector<HTMLElement>('[data-nav-links]')
  if (navLinksHost) {
    stopNavSpy = mountNavSpy(navLinksHost, {
      linkSelector: 'a[href^="#"]',
      // Un seul token : `classList.toggle()` refuse une chaîne à espaces.
      activeClass: 'is-active',
    })
  }

  const textLoopHost = root.querySelector<HTMLElement>('[data-text-loop]')
  if (textLoopHost) {
    stopTextLoop = mountTextLoop(textLoopHost, {
      items: [
        'resume_task',
        'read_task_detail',
        'log_step',
        'add_constraint',
        'reject_approach',
        'add_decision',
        'complete_task',
      ],
    })
  }

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

function clearLinkFragment(): void {
  if (typeof history === 'undefined') return
  history.replaceState(null, '', `${location.pathname}${location.search}`)
}

function onNetworkChange(): void {
  online = navigator.onLine
  scheduleRender()
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

  if (showingShortcuts) {
    showingShortcuts = false
    event.preventDefault()
    renderNow()
    return
  }

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

  const openForm =
    editing !== null ||
    loggingStep ||
    answering !== null ||
    attaching !== null ||
    disputing !== null
  if (openForm) {
    editing = null
    loggingStep = false
    answering = null
    attaching = null
    disputing = null
    humanError = null
    drafts['dispute-reason'] = ''
    drafts['edit-value'] = ''
    drafts['edit-reason'] = ''
    drafts['answer-text'] = ''
    resetStepDraft()
    drafts['attach-content'] = ''
    event.preventDefault()
    renderNow()
  }
}

function onShortcut(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (typingSomewhereElse(event.target)) return

  const act = (run: () => void) => {
    event.preventDefault()
    run()
  }

  switch (event.key) {
    case '?':
      return act(() => {
        showingShortcuts = !showingShortcuts
        renderNow()
      })
    case 's':
      return act(() => {
        if (store.currentTask()?.status !== 'active') return
        loggingStep = true
        editing = null
        renderNow()
        document.querySelector<HTMLInputElement>('#step-action')?.focus()
      })
    case 'n':
      return act(() => {
        creating = true
        clearNotice()
        humanError = null
        renderNow()
        document.querySelector<HTMLInputElement>('#new-title')?.focus()
      })
    case 'e':
      return act(() => {
        const task = store.currentTask()
        if (!task || task.status !== 'active') return
        startEditing({ kind: 'next' }, task.next ?? '')
      })
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
  previewNotice = null
  previewAuthOpen = false
  connectorEditing = null
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
  offered = null
  linkRead = false
  linkPending = false
  editing = null
  loggingStep = false
  answering = null
  attaching = null
  disputing = null
  showingShortcuts = false
  showingTrail = null
  storage = UNKNOWN
  storageRead = false
  online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true
  carryRules = false
  searchFilter = 'all'
  showArchived = false

  render()
  const subscriptions = [
    onRegistrationChange(scheduleRender),
    onCall(scheduleRender),
    store.subscribe(scheduleRender),
    onCloudStateChange(scheduleRender),
  ]

  document.addEventListener('keydown', focusSearchOnSlash)
  document.addEventListener('keydown', closeOnEscape)
  document.addEventListener('keydown', onShortcut)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onNetworkChange)
  window.addEventListener('offline', onNetworkChange)

  return () => {
    document.removeEventListener('keydown', focusSearchOnSlash)
    document.removeEventListener('keydown', closeOnEscape)
    document.removeEventListener('keydown', onShortcut)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', onNetworkChange)
    window.removeEventListener('offline', onNetworkChange)
    hideRevealed()
    clearNotice()
    for (const off of subscriptions) off()
    if (pendingFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pendingFrame)
      else clearTimeout(pendingFrame)
      pendingFrame = null
    }
    stopTextLoop?.()
    stopTextLoop = null
    renderScheduled = false
    root = null
  }
}

export function __renderNow(): void {
  renderNow()
}
