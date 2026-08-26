// L'enregistrement WebMCP est un effet de bord d'import, volontairement placé
// avant tout rendu. Il ne dépend d'aucun composant et ne doit jamais en
// dépendre : le mode strict de React, quand il arrivera, monte deux fois.
import './webmcp'

import './tokens.css'
import './style.css'
import { renderNoTask, renderTaskState } from './domain/render'
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
      <p><button type="button" id="seed" class="btn">Ouvrir un cahier de démonstration</button></p>
    </div>`
  }

  return `<section>
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

function render(): void {
  const hasTask = store.getSnapshot().task !== null
  root!.innerHTML = `<main>
      <header>
        <h1>Cahier de quart — banc d'essai</h1>
        <p class="muted">
          Les six outils écrivent dans un cahier versionné et persistant.
          Toute écriture d'agent porte la version sur laquelle il croit
          travailler ; une divergence est refusée, jamais fusionnée.
        </p>
      </header>
      ${renderStatus()}
      ${renderWitness()}
      ${renderTask()}
      ${hasTask ? '' : `<p class="muted">${escapeHtml(renderNoTask().split('\n')[0])}</p>`}
    </main>`

  document.querySelector('#reset-witness')?.addEventListener('click', () => resetCalls())
  document.querySelector('#seed')?.addEventListener('click', () => {
    void store.createAndOpenTask(
      'Refactor the authentication module',
      'Map the existing entry points',
    )
  })
}

render()
onRegistrationChange(render)
onCall(render)
store.subscribe(render)
void store.init()
