// L'enregistrement WebMCP est un effet de bord d'import, volontairement placé
// avant tout rendu. Il ne dépend d'aucun composant et ne doit jamais en
// dépendre : le mode strict de React, quand il arrivera, monte deux fois.
import './webmcp'

import './tokens.css'
import './style.css'
import { buildDemoTask } from './demo/seed'
import { renderNoTask, renderTaskState } from './domain/render'
import { addConstraint, reopenTask, setConstraintActive, verifyEvidence } from './domain/task'
import * as store from './store/taskStore'
import { getCalls, getRegistrationState, onCall, onRegistrationChange, resetCalls } from './webmcp'

/**
 * Banc d'essai.
 *
 * Ce n'est pas le produit — le tableau de bord viendra au J4, et son apparence
 * relève d'une autre voie. Cette page sert à voir en direct ce qu'un agent fait
 * au cahier : la version qui avance, les écritures refusées, et le texte exact
 * que `resume_task` restitue.
 */

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderStatus(): string {
  const { phase, availability, toolNames, error } = getRegistrationState()

  if (phase === 'registered') {
    const surface = availability.supported ? availability.surface : 'inconnue'
    return `<div class="status status--ok">
      <p class="status__title">WebMCP actif — ${toolNames.length} outils exposés</p>
      <p class="mono">${toolNames.join(' · ')}</p>
      <p class="muted">API lue sur <code>${surface}.modelContext</code>.</p>
    </div>`
  }

  if (phase === 'failed') {
    return `<div class="status status--error">
      <p class="status__title">L'enregistrement a échoué</p>
      <p>${escapeHtml(error ?? 'raison inconnue')}</p>
    </div>`
  }

  if (phase === 'pending') return `<div class="status"><p>Enregistrement en cours…</p></div>`

  const insecure = !availability.supported && availability.reason === 'insecure-context'
  if (insecure) {
    return `<div class="status status--warn">
      <p class="status__title">WebMCP exige un contexte sécurisé</p>
      <p>Cette page doit être servie en HTTPS ou depuis <code>localhost</code>.</p>
    </div>`
  }

  return `<div class="status status--warn">
    <p class="status__title">WebMCP n'est pas disponible dans ce navigateur</p>
    <p>
      1. ouvrir <code>chrome://flags/#enable-webmcp-testing</code><br />
      2. passer le drapeau à <strong>Enabled</strong><br />
      3. relancer le navigateur, puis recharger cette page
    </p>
    <p class="muted">
      Lu sur <code>document.modelContext</code>, repli <code>navigator.modelContext</code>
      — déprécié depuis Chrome 150.
    </p>
  </div>`
}

function renderWitness(): string {
  const calls = getCalls()
  const refused = calls.filter((c) => c.refused).length
  const rows = [...calls]
    .reverse()
    .slice(0, 10)
    .map(
      (c) =>
        `<li class="${c.refused ? 'call call--refused' : 'call'}">
           <code>${c.tool}</code>
           <span>${c.refused ? 'REFUSÉ' : 'appliqué'}</span>
           <span class="muted">${new Date(c.at).toLocaleTimeString('fr-FR')}</span>
         </li>`,
    )
    .join('')

  return `<div class="witness">
      <span class="witness__count">${calls.length}</span>
      <span class="witness__label">
        appel${calls.length > 1 ? 's' : ''} d'outil<br />
        <span class="muted">dont ${refused} refusé${refused > 1 ? 's' : ''}</span>
      </span>
      <button type="button" id="reset-witness" class="btn">Remettre à zéro</button>
    </div>
    ${rows ? `<ul class="calls">${rows}</ul>` : ''}`
}

function renderTask(): string {
  const { status, task, error } = store.getSnapshot()

  if (status === 'loading') return `<p class="muted">Chargement du cahier…</p>`
  if (status === 'error') {
    return `<div class="status status--error"><p>${escapeHtml(error ?? '')}</p></div>`
  }
  if (!task) {
    return `<div class="status status--warn">
      <p class="status__title">Aucun cahier ouvert</p>
      <p>Les six outils exigent une tâche existante. Ouvrez-en une pour tester.</p>
      <p><button type="button" id="seed" class="btn">Ouvrir le cahier de démonstration</button></p>
    </div>`
  }

  const clôturée =
    task.status === 'completed'
      ? `<div class="status status--warn">
           <p class="status__title">Tâche close</p>
           <p>Les écritures d'agent sont refusées. L'humain reste maître : il peut rouvrir.</p>
           <p><button type="button" id="reopen" class="btn">Rouvrir la tâche</button></p>
         </div>`
      : ''

  return `${clôturée}
    <section>
      <h2>Version en direct</h2>
      <p class="version">v${task.version} <span class="muted">— ${task.steps.length} étapes,
        ${task.constraints.filter((c) => c.active).length} contraintes actives,
        ${task.rejected.length} rejets</span></p>
    </section>
    <section>
      <h2>Ce que <code>resume_task</code> restitue</h2>
      <pre>${escapeHtml(renderTaskState(task))}</pre>
    </section>`
}

/**
 * La page présente LA TÂCHE, pas le mécanisme qui la porte.
 *
 * Un essai du J3 l'a montré crûment : quand l'en-tête expliquait le versionnage
 * et le refus d'état périmé, l'agent a conclu que sa mission était d'éprouver
 * ce mécanisme, et il a passé son tour à tester le garde-fou au lieu de
 * reprendre le travail. Le texte visible de la page entre en concurrence avec
 * la description des outils pour l'attention de l'agent — et il gagne.
 *
 * L'explication du mécanisme est donc reléguée en pied de page, où elle
 * renseigne un humain de passage sans détourner un agent.
 */
function titre(): string {
  const task = store.getSnapshot().task
  return task ? task.title : 'Cahier de quart'
}

function sousTitre(): string {
  const task = store.getSnapshot().task
  if (!task) return 'Aucune tâche ouverte sur cet appareil.'
  if (task.status === 'completed') return `Tâche close en v${task.version}.`
  return task.next ? `Prochaine action : ${task.next}` : 'Prochaine action non définie.'
}

/**
 * Brouillon de la contrainte en cours de saisie.
 *
 * Il vit hors du rendu à dessein. La page se redessine à chaque écriture
 * d'agent, et c'est précisément ce qui doit arriver pendant qu'un humain tape
 * une contrainte : sans ce report, sa saisie serait effacée par l'agent qu'il
 * est en train de contredire.
 */
let brouillon = ''

function renderSupervision(): string {
  const task = store.getSnapshot().task
  if (!task) return ''

  const contraintes = task.constraints
    .map(
      (c) => `<li class="regle${c.active ? '' : ' regle--levee'}">
        <span class="chip chip--${c.source}">${c.source}</span>
        <span class="regle__texte">${escapeHtml(c.rule)}</span>
        <span class="muted">v${c.addedAtVersion}</span>
        <button type="button" class="btn" data-toggle="${c.id}" data-active="${c.active}">
          ${c.active ? 'Lever' : 'Rétablir'}
        </button>
      </li>`,
    )
    .join('')

  // Une preuve ne devient « vérifiée humain » que par un clic. C'est le seul
  // chemin vers ce degré, et il n'existait jusqu'ici que dans le domaine.
  const àValider = task.steps
    .filter((s) => s.evidence !== null && s.confidence !== 'human_verified')
    .map(
      (s) => `<li class="regle">
        <span class="chip chip--${s.confidence}">${s.confidence}</span>
        <span class="regle__texte">${escapeHtml(s.action)}</span>
        <button type="button" class="btn" data-verify="${s.id}">Valider la preuve</button>
      </li>`,
    )
    .join('')

  const saisie =
    task.status === 'active'
      ? `<form id="form-contrainte" class="saisie">
           <label for="new-constraint">Ajouter une contrainte</label>
           <input id="new-constraint" type="text" autocomplete="off"
                  placeholder="Ne jamais modifier le schéma de base" />
           <button type="submit" class="btn">Ajouter</button>
         </form>
         <p class="muted">
           Une contrainte posée ici est humaine : elle n'est jamais refusée, et
           elle périme la version sur laquelle l'agent travaille.
         </p>`
      : ''

  return `<section class="supervision">
      <h2>Contraintes</h2>
      <ul class="regles">${contraintes || '<li class="muted">Aucune.</li>'}</ul>
      ${saisie}
      ${àValider ? `<h2>Preuves à valider</h2><ul class="regles">${àValider}</ul>` : ''}
    </section>`
}

/** Rebranche les commandes de supervision après chaque rendu. */
function brancherSupervision(): void {
  const form = document.querySelector<HTMLFormElement>('#form-contrainte')
  const input = document.querySelector<HTMLInputElement>('#new-constraint')

  if (input) {
    input.value = brouillon
    input.addEventListener('input', () => {
      brouillon = input.value
    })
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const règle = brouillon.trim()
    if (!règle) return
    brouillon = ''
    void store.mutate((state) => addConstraint(state, { rule: règle, basedOnVersion: null }, 'human'))
  })

  for (const bouton of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    bouton.addEventListener('click', () => {
      const id = bouton.dataset.toggle!
      const actif = bouton.dataset.active === 'true'
      void store.mutate((state) => setConstraintActive(state, id, !actif))
    })
  }

  for (const bouton of document.querySelectorAll<HTMLButtonElement>('[data-verify]')) {
    bouton.addEventListener('click', () => {
      void store.mutate((state) => verifyEvidence(state, bouton.dataset.verify!))
    })
  }
}

function render(): void {
  // Le champ de saisie est remplacé par le rendu : on note s'il avait le focus
  // et où était le curseur, pour que l'agent ne coupe pas la parole à l'humain.
  const actif = document.activeElement
  const avaitFocus = actif instanceof HTMLInputElement && actif.id === 'new-constraint'
  const curseur = avaitFocus ? (actif as HTMLInputElement).selectionStart : null

  const hasTask = store.getSnapshot().task !== null
  root!.innerHTML = `<main>
      <header>
        <h1>${escapeHtml(titre())}</h1>
        <p class="muted">${escapeHtml(sousTitre())}</p>
      </header>
      ${renderTask()}
      ${renderSupervision()}
      ${renderStatus()}
      ${renderWitness()}
      ${hasTask ? '' : `<p class="muted">${escapeHtml(renderNoTask().split('\n')[0])}</p>`}
      <footer class="muted">
        <p>
          Cahier de quart — mémoire de tâche persistante et supervisée, exposée
          aux agents par WebMCP.
        </p>
      </footer>
    </main>`

  document.querySelector('#reset-witness')?.addEventListener('click', () => resetCalls())
  brancherSupervision()

  if (avaitFocus) {
    const input = document.querySelector<HTMLInputElement>('#new-constraint')
    input?.focus()
    if (curseur !== null) input?.setSelectionRange(curseur, curseur)
  }

  document.querySelector('#reopen')?.addEventListener('click', () => {
    const motif = window.prompt('Pourquoi rouvrir cette tâche ?')
    if (!motif?.trim()) return
    void store.mutate((state) => reopenTask(state, motif))
  })
  document.querySelector('#seed')?.addEventListener('click', () => {
    void store.openPreparedTask(buildDemoTask())
  })
}

render()
onRegistrationChange(render)
onCall(render)
store.subscribe(render)
void store.init()
