// L'enregistrement WebMCP est un effet de bord d'import, volontairement placé
// avant tout rendu. Il ne dépend d'aucun composant et ne doit jamais en
// dépendre.
import './webmcp'

import './tokens.css'
import './style.css'
import {
  FIXED_STATE,
  RESUME_TASK_DESCRIPTION,
  getCallStats,
  getRegistrationState,
  onCall,
  onRegistrationChange,
} from './webmcp'

/**
 * Banc d'essai du J1.
 *
 * Cette page n'est pas le produit. Elle sert à voir, à l'œil nu, si un agent
 * appelle `resume_task` : le compteur s'incrémente en direct pendant qu'on
 * regarde. C'est le seul retour dont on a besoin ce soir.
 */

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderStatus(): string {
  const { phase, availability, toolNames, error } = getRegistrationState()

  if (phase === 'registered') {
    const surface = availability.supported ? availability.surface : 'inconnue'
    return `
      <div class="status status--ok">
        <p class="status__title">WebMCP actif — ${toolNames.length} outil exposé</p>
        <p>Un agent peut appeler <code>${toolNames.join('</code>, <code>')}</code>.</p>
        <p class="muted">API lue sur <code>${surface}.modelContext</code>.</p>
      </div>`
  }

  if (phase === 'failed') {
    return `
      <div class="status status--error">
        <p class="status__title">L'enregistrement a échoué</p>
        <p>${escapeHtml(error ?? 'raison inconnue')}</p>
      </div>`
  }

  if (phase === 'pending') {
    return `<div class="status"><p>Enregistrement en cours…</p></div>`
  }

  const insecure = !availability.supported && availability.reason === 'insecure-context'

  if (insecure) {
    return `
      <div class="status status--warn">
        <p class="status__title">WebMCP exige un contexte sécurisé</p>
        <p>
          Cette page doit être servie en HTTPS ou depuis <code>localhost</code>.
          Aucun outil n'est exposé aux agents.
        </p>
      </div>`
  }

  return `
    <div class="status status--warn">
      <p class="status__title">WebMCP n'est pas disponible dans ce navigateur</p>
      <p>Pour l'activer dans Chrome 149 ou plus récent :</p>
      <p>
        1. ouvrir <code>chrome://flags/#enable-webmcp-testing</code><br />
        2. passer le drapeau à <strong>Enabled</strong><br />
        3. relancer le navigateur, puis recharger cette page
      </p>
      <p class="muted">
        L'API est lue sur <code>document.modelContext</code>, avec repli sur
        <code>navigator.modelContext</code> — déprécié depuis Chrome 150.
      </p>
    </div>`
}

function renderWitness(): string {
  const { callCount, lastCallAt } = getCallStats()
  const when = lastCallAt
    ? new Date(lastCallAt).toLocaleTimeString('fr-FR')
    : 'jamais appelé pour l’instant'

  return `
    <div class="witness">
      <span class="witness__count">${callCount}</span>
      <span class="witness__label">
        appel${callCount > 1 ? 's' : ''} à <code>resume_task</code><br />
        <span class="muted">dernier : ${when}</span>
      </span>
    </div>`
}

function render(): void {
  root!.innerHTML = `
    <main>
      <header>
        <h1>Cahier de quart — banc d'essai J1</h1>
        <p class="muted">
          Objectif unique de cette page : vérifier qu'un agent, dans une
          conversation neuve et sans historique, découvre
          <code>resume_task</code> et l'appelle de lui-même.
        </p>
      </header>

      ${renderStatus()}
      ${renderWitness()}

      <section>
        <h2>Description de l'outil</h2>
        <pre>${escapeHtml(RESUME_TASK_DESCRIPTION)}</pre>
      </section>

      <section>
        <h2>Ce que l'outil rend</h2>
        <p class="muted">
          État figé. Un agent qui reprend correctement citera l'approche C,
          refusera la variante B et n'ajoutera aucune dépendance.
        </p>
        <pre>${escapeHtml(FIXED_STATE)}</pre>
      </section>
    </main>`
}

render()
onRegistrationChange(render)
onCall(render)
